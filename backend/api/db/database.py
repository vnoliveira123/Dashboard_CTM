import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from config import DATABASE_URL
from api.db.models import Base

logger = logging.getLogger(__name__)

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=40,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Índices sobre tabelas regulares e hypertables (idempotentes)
_INDEXES = [
    # mat_execucoes_timeline — hypertable principal
    "CREATE INDEX IF NOT EXISTS ix_timeline_tabela_job  ON mat_execucoes_timeline (tabela, job)",
    "CREATE INDEX IF NOT EXISTS ix_timeline_data        ON mat_execucoes_timeline (data_execucao)",
    "CREATE INDEX IF NOT EXISTS ix_timeline_status      ON mat_execucoes_timeline (status)",
    "CREATE INDEX IF NOT EXISTS ix_timeline_grupo       ON mat_execucoes_timeline (grupo)",
    "CREATE INDEX IF NOT EXISTS ix_timeline_rotina      ON mat_execucoes_timeline (left(tabela, 4))",
    "CREATE INDEX IF NOT EXISTS ix_timeline_ambiente    ON mat_execucoes_timeline (ambiente)",
    # raw_processos
    "CREATE INDEX IF NOT EXISTS ix_processos_tabela     ON raw_processos (tabela)",
    "CREATE INDEX IF NOT EXISTS ix_processos_grupo      ON raw_processos (grupo)",
    "CREATE INDEX IF NOT EXISTS ix_processos_carga      ON raw_processos (carga)",
    "CREATE INDEX IF NOT EXISTS ix_processos_isd        ON raw_processos (isd)",
    "CREATE INDEX IF NOT EXISTS ix_processos_alerta     ON raw_processos (tem_alerta)",
    "CREATE INDEX IF NOT EXISTS ix_processos_rotina     ON raw_processos (left(tabela, 4))",
    # raw_execucoes
    "CREATE INDEX IF NOT EXISTS ix_execucoes_tabela_job ON raw_execucoes (tabela, job)",
    "CREATE INDEX IF NOT EXISTS ix_execucoes_inicio     ON raw_execucoes (inicio)",
    "CREATE INDEX IF NOT EXISTS ix_execucoes_status     ON raw_execucoes (status)",
    # fluxos_processos
    "CREATE INDEX IF NOT EXISTS ix_fluxos_origem        ON fluxos_processos (tabela_origem, job_origem)",
    "CREATE INDEX IF NOT EXISTS ix_fluxos_destino       ON fluxos_processos (tabela_destino, job_destino)",
]


def _ts(conn, sql: str, label: str) -> bool:
    """Executa DDL TimescaleDB; ignora falha e faz rollback se necessário."""
    try:
        conn.execute(text(sql))
        conn.commit()
        return True
    except Exception as exc:
        logger.warning('TimescaleDB [%s] skipped: %s', label, exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def _setup_timescaledb(conn) -> None:
    """
    Configura TimescaleDB na mat_execucoes_timeline:
      1. Habilita a extensão
      2. Garante PK composta (id, data_execucao) — exigida pelo TimescaleDB
      3. Converte em hypertable particionada por mês
      4. Cria Continuous Aggregate cagg_execucoes_dia (pré-cômputo diário)
      5. Política de atualização automática do aggregate
      6. Compressão por segmento (tabela+job) — ~90% de redução de espaço
      7. Política de compressão automática (chunks > 7 dias)
    """
    # 1. Extensão — se falhar, não é TimescaleDB; aborta silenciosamente
    if not _ts(conn, "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE", "extension"):
        return

    # 2. Migrar PK para incluir data_execucao (caso seja uma instalação existente)
    pk_ok = conn.execute(text("""
        SELECT COUNT(*) FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conname = 'mat_execucoes_timeline_pkey'
          AND a.attname = 'data_execucao'
          AND c.contype = 'p'
    """)).scalar() or 0

    if not pk_ok:
        _ts(conn,
            "ALTER TABLE mat_execucoes_timeline "
            "DROP CONSTRAINT IF EXISTS mat_execucoes_timeline_pkey",
            "drop_old_pk")
        _ts(conn,
            "ALTER TABLE mat_execucoes_timeline "
            "ADD PRIMARY KEY (id, data_execucao)",
            "add_composite_pk")

    # 3. Hypertable (1 chunk = 1 mês)
    _ts(conn, """
        SELECT create_hypertable(
            'mat_execucoes_timeline', 'data_execucao',
            chunk_time_interval => INTERVAL '1 month',
            if_not_exists       => TRUE,
            migrate_data        => TRUE
        )
    """, "hypertable")

    # 4. Continuous Aggregate diário — pré-computa OK/NOK/avg_dur por (dia, tabela, job, grupo, ambiente)
    _ts(conn, """
        CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_execucoes_dia
        WITH (timescaledb.continuous) AS
        SELECT
            time_bucket('1 day', data_execucao)                    AS dia,
            tabela,
            job,
            grupo,
            ambiente,
            COUNT(*)                                               AS total,
            SUM(CASE WHEN status = 'OK'     THEN 1 ELSE 0 END)    AS ok,
            SUM(CASE WHEN status = 'NOT OK' THEN 1 ELSE 0 END)    AS nok,
            AVG(duracao_minutos)                                   AS avg_dur,
            MAX(duracao_minutos)                                   AS max_dur
        FROM mat_execucoes_timeline
        GROUP BY dia, tabela, job, grupo, ambiente
        WITH NO DATA
    """, "continuous_aggregate")

    # 5. Política: refrescar o aggregate automaticamente 1× por dia
    _ts(conn, """
        SELECT add_continuous_aggregate_policy(
            'cagg_execucoes_dia',
            start_offset      => INTERVAL '7 months',
            end_offset        => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 day',
            if_not_exists     => TRUE
        )
    """, "cagg_policy")

    # 6. Configuração de compressão (segmentby = tabela+job → máxima taxa)
    _ts(conn, """
        ALTER TABLE mat_execucoes_timeline SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'tabela, job',
            timescaledb.compress_orderby   = 'data_execucao DESC'
        )
    """, "compress_config")

    # 7. Política: comprimir automaticamente chunks com mais de 7 dias
    _ts(conn, """
        SELECT add_compression_policy(
            'mat_execucoes_timeline',
            INTERVAL '7 days',
            if_not_exists => TRUE
        )
    """, "compress_policy")

    logger.info('TimescaleDB configurado: hypertable + cagg + compressão')


def _migrate_add_ambiente(conn) -> None:
    """Migration: adds ambiente column to all tables and rebuilds cagg if needed."""
    cagg_has_amb = conn.execute(text("""
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'cagg_execucoes_dia' AND column_name = 'ambiente'
    """)).scalar() or 0
    if cagg_has_amb:
        return

    logger.info("Migration: adding 'ambiente' column…")
    for tbl in ('raw_processos', 'raw_execucoes', 'mat_execucoes_timeline'):
        try:
            conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS ambiente VARCHAR(10)"))
            conn.commit()
        except Exception as exc:
            logger.warning("ambiente column on %s: %s", tbl, exc)
            try:
                conn.rollback()
            except Exception:
                pass

    _ts(conn, "DROP MATERIALIZED VIEW IF EXISTS cagg_execucoes_dia CASCADE", "drop_old_cagg")
    logger.info("cagg_execucoes_dia dropped — will be recreated with ambiente column")


def init_db():
    """Cria tabelas, configura TimescaleDB e cria índices."""
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _migrate_add_ambiente(conn)
        _setup_timescaledb(conn)
        for ddl in _INDEXES:
            try:
                conn.execute(text(ddl))
            except Exception as exc:
                logger.warning('Index skipped: %s — %s', ddl[:60], exc)
                conn.rollback()
        conn.commit()
    print('✅ Banco de dados inicializado')


def get_db():
    """Fornece conexão com o banco de dados."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
