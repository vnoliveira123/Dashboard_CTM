import pandas as pd
import psycopg2.extras
import logging
from sqlalchemy.orm import Session
from sqlalchemy import text
from api.db.database import engine
from datetime import datetime

logger = logging.getLogger(__name__)

_FMT_LOG    = '%H:%M - %d/%m/%y'
_CHUNK_SIZE = 100_000

_INSERT_SQL = """
    INSERT INTO raw_execucoes
        (tabela, job, grupo, inicio, fim, status,
         hora_proc, minutos_proc, execucoes, ambiente, data_insercao)
    VALUES %s
"""


def ingerir_logs_incremental(
    arquivo_csv: str,
    db: Session,
    *,
    incremental: bool = False,
) -> int:
    """
    Ingere LOG.csv em lotes de 100 K linhas usando psycopg2.extras.execute_values.

    incremental=False (padrão): TRUNCATE + carga completa.
    incremental=True: insere apenas linhas com inicio > MAX(inicio) já no banco.
    """
    try:
        if incremental:
            watermark = db.execute(
                text('SELECT MAX(inicio) FROM raw_execucoes')
            ).scalar()
            if watermark is None:
                logger.info('raw_execucoes vazia — carga inicial completa')
            else:
                logger.info(f'Watermark: {watermark} — modo incremental')
        else:
            db.execute(text('TRUNCATE TABLE raw_execucoes RESTART IDENTITY'))
            db.commit()
            watermark = None
            logger.info('raw_execucoes truncada — carga completa')

        total     = 0
        chunk_num = 0
        cols_ok   = False
        _now      = datetime.utcnow()

        reader = pd.read_csv(
            arquivo_csv,
            sep='|',
            encoding='utf-8',
            dtype=str,
            chunksize=_CHUNK_SIZE,
            on_bad_lines='skip',
        )

        raw_conn = engine.raw_connection()
        try:
            cur = raw_conn.cursor()

            for chunk in reader:
                chunk_num += 1

                if not cols_ok:
                    for col in ('TABELA', 'JOB', 'GRUPO', 'STATUS', 'INICIO'):
                        if col not in chunk.columns:
                            logger.error(f'Coluna obrigatoria ausente: {col}')
                            return 0
                    cols_ok = True

                # ── Datas (vetorizado) ────────────────────────────────────────
                chunk['_inicio'] = pd.to_datetime(
                    chunk['INICIO'], format=_FMT_LOG, errors='coerce'
                )
                chunk['_fim'] = pd.to_datetime(
                    chunk['FIM'], format=_FMT_LOG, errors='coerce'
                )
                chunk = chunk[chunk['_inicio'].notna()].copy()
                if chunk.empty:
                    continue

                # Modo incremental: pular linhas já carregadas
                if watermark is not None:
                    chunk = chunk[chunk['_inicio'] > watermark]
                    if chunk.empty:
                        continue

                # ── Duração: 'mm:ss' → float minutos (vetorizado) ────────────
                _parts = chunk['MINUTOS_PROC'].str.strip().str.split(':', n=1, expand=True)
                chunk['_min_proc'] = (
                    pd.to_numeric(_parts[0], errors='coerce') +
                    pd.to_numeric(
                        _parts.get(1, pd.Series(['0'] * len(chunk))),
                        errors='coerce',
                    ) / 60
                )
                chunk['_execucoes'] = (
                    pd.to_numeric(chunk['EXECUCOES'], errors='coerce')
                    .fillna(1).astype(int)
                )

                # ── Montar tuplas para execute_values ─────────────────────────
                inicio_list   = [t.to_pydatetime() for t in chunk['_inicio']]
                fim_list      = [
                    t.to_pydatetime() if pd.notna(t) else None
                    for t in chunk['_fim']
                ]
                tabela_list   = chunk['TABELA'].where(chunk['TABELA'].notna(),   None).tolist()
                job_list      = chunk['JOB'].where(chunk['JOB'].notna(),         None).tolist()
                grupo_list    = chunk['GRUPO'].where(chunk['GRUPO'].notna(),     None).tolist()
                status_list   = chunk['STATUS'].where(chunk['STATUS'].notna(),   None).tolist()
                hora_list     = chunk['HORA_PROC'].where(chunk['HORA_PROC'].notna(), None).tolist()
                min_proc_list = chunk['_min_proc'].where(chunk['_min_proc'].notna(), None).tolist()
                exec_list     = chunk['_execucoes'].tolist()
                amb_list      = (
                    chunk['AMBIENTE'].where(chunk['AMBIENTE'].notna(), None).tolist()
                    if 'AMBIENTE' in chunk.columns else [None] * len(chunk)
                )

                tuples = list(zip(
                    tabela_list, job_list, grupo_list,
                    inicio_list, fim_list, status_list,
                    hora_list, min_proc_list, exec_list,
                    amb_list,
                    [_now] * len(chunk),
                ))

                psycopg2.extras.execute_values(
                    cur, _INSERT_SQL, tuples, page_size=10_000
                )
                raw_conn.commit()
                total += len(tuples)

                if chunk_num % 10 == 0:
                    logger.info(
                        f'LOG ingestion: chunk {chunk_num} '
                        f'| {total:,} registros inseridos'
                    )

        finally:
            cur.close()
            raw_conn.close()

        logger.info(f'LOG ingestao concluida: {total:,} registros')
        return total

    except Exception as e:
        logger.error(f'Erro ao ingerir LOGS: {e}')
        return 0
