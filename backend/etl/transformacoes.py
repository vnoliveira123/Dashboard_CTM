import logging
from sqlalchemy.orm import Session
from sqlalchemy import func, case, text
from api.db.models import Execucao, ProcessoStats, ExecucaoTimeline
from api.db.database import engine
from datetime import datetime

logger = logging.getLogger(__name__)

_OK = 'OK'
_NOK = 'NOT OK'


def agregar_processos(db: Session) -> int:
    """
    Agrega execuções por processo e atualiza mat_processos_stats.
    Usa bulk_insert/update_mappings em vez de UPSERT linha a linha.
    """
    try:
        # Agrega no banco (uma query GROUP BY)
        resultados = db.query(
            Execucao.tabela,
            Execucao.job,
            Execucao.grupo,
            func.count(Execucao.id).label('total'),
            func.sum(case((Execucao.status == _OK,  1), else_=0)
                     ).label('sucesso'),
            func.sum(case((Execucao.status == _NOK, 1), else_=0)).label('falha'),
            func.avg(Execucao.minutos_proc).label('duracao_media'),
            func.max(Execucao.fim).label('ultima_execucao'),
        ).group_by(Execucao.tabela, Execucao.job, Execucao.grupo).all()

        # Pré-carregar chaves existentes (uma query)
        existing: dict[tuple, int] = {
            (s.tabela, s.job, s.grupo): s.id
            for s in db.query(
                ProcessoStats.tabela, ProcessoStats.job,
                ProcessoStats.grupo,  ProcessoStats.id,
            ).all()
        }

        insert_maps: list[dict] = []
        update_maps: list[dict] = []
        _now = datetime.utcnow()

        for r in resultados:
            total = r.total or 0
            sucesso = r.sucesso or 0
            taxa = (sucesso / total * 100) if total > 0 else 0.0

            campos = {
                'total_execucoes':    total,
                'execucoes_sucesso':  sucesso,
                'execucoes_falha':    r.falha or 0,
                'taxa_sucesso':       taxa,
                'duracao_media':      float(r.duracao_media or 0.0),
                'ultima_execucao':    r.ultima_execucao,
                'data_atualizacao':   _now,
            }

            key = (r.tabela, r.job, r.grupo)
            if key in existing:
                campos['id'] = existing[key]
                update_maps.append(campos)
            else:
                campos.update(tabela=r.tabela, job=r.job, grupo=r.grupo)
                insert_maps.append(campos)

        if insert_maps:
            db.bulk_insert_mappings(ProcessoStats, insert_maps)
        if update_maps:
            db.bulk_update_mappings(ProcessoStats, update_maps)

        db.commit()
        total_upserted = len(insert_maps) + len(update_maps)
        logger.info(f'Stats atualizados: {total_upserted:,}')
        return total_upserted

    except Exception as e:
        logger.error(f'Erro ao agregar processos: {e}')
        db.rollback()
        return 0


def agregar_execucoes_timeline(db: Session) -> int:
    """
    Popula mat_execucoes_timeline via INSERT...SELECT puro no banco.
    Com TimescaleDB, o TRUNCATE age sobre o hypertable (todos os chunks).
    Ao final, atualiza o Continuous Aggregate cagg_execucoes_dia.
    """
    try:
        # TRUNCATE: instantâneo em hypertables (descarta todos os chunks)
        db.execute(text('TRUNCATE TABLE mat_execucoes_timeline'))

        # INSERT...SELECT: processamento 100% server-side — zero tráfego Python
        db.execute(text('''
            INSERT INTO mat_execucoes_timeline
                (tabela, job, grupo, data_execucao, status, duracao_minutos, ambiente, data_atualizacao)
            SELECT
                tabela,
                job,
                grupo,
                inicio        AS data_execucao,
                status,
                minutos_proc  AS duracao_minutos,
                ambiente,
                NOW()         AS data_atualizacao
            FROM raw_execucoes
            WHERE inicio IS NOT NULL
        '''))

        db.commit()

        count = db.execute(
            text('SELECT COUNT(*) FROM mat_execucoes_timeline')
        ).scalar() or 0
        logger.info(f'Timeline atualizada: {count:,} registros')

        # Atualiza o Continuous Aggregate (TimescaleDB) fora de bloco de transação
        try:
            with engine.connect().execution_options(isolation_level='AUTOCOMMIT') as conn:
                conn.execute(text(
                    "CALL refresh_continuous_aggregate("
                    "    'cagg_execucoes_dia', NULL, NOW()::timestamp"
                    ")"
                ))
            logger.info('Continuous Aggregate cagg_execucoes_dia atualizado')
        except Exception as cagg_err:
            logger.info(
                'Continuous Aggregate indisponível (não-TimescaleDB): %s', cagg_err)
            try:
                with engine.connect().execution_options(isolation_level='AUTOCOMMIT') as conn:
                    conn.execute(
                        text("REFRESH MATERIALIZED VIEW cagg_execucoes_dia"))
                logger.info(
                    'cagg_execucoes_dia atualizado via REFRESH MATERIALIZED VIEW')
            except Exception as mv_err:
                logger.warning(
                    'Fallback REFRESH MATERIALIZED VIEW falhou: %s', mv_err)

        return count

    except Exception as e:
        logger.error(f'Erro ao agregar timeline: {e}')
        db.rollback()
        return 0
