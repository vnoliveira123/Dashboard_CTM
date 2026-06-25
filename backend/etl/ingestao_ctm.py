import pandas as pd
import numpy as np
import logging
from sqlalchemy.orm import Session
from sqlalchemy import text
from api.db.models import Processo
from datetime import datetime

logger = logging.getLogger(__name__)


def _clean(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and np.isnan(value):
        return None
    v = str(value).strip()
    return v if v else None


def ingerir_ctm(arquivo_csv: str, db: Session) -> int:
    """
    Ingere CTM.csv com UPSERT em bulk.
    Pré-carrega todas as chaves existentes de uma só query e usa
    bulk_insert/update_mappings — elimina os 136 K SELECTs do loop original.
    """
    try:
        df = pd.read_csv(arquivo_csv, sep='|', encoding='utf-8', dtype=str)
        logger.info(f'CTM lido: {len(df)} linhas logicas')

        for col in ('TABELA', 'JOB', 'GRUPO'):
            if col not in df.columns:
                logger.error(f'Coluna obrigatoria ausente: {col}')
                return 0

        # Carga completa: limpa todas as tabelas dependentes antes de recarregar
        for tbl in ('mat_processos_stats', 'fluxos_processos', 'raw_processos'):
            db.execute(text(f'TRUNCATE TABLE {tbl} RESTART IDENTITY CASCADE'))
        db.commit()
        logger.info('raw_processos (+ dependentes) truncados — carga completa')

        # NaN -> None antes de converter para dicts
        df = df.where(pd.notnull(df), None)

        # ── Inserção bulk direta (sem upsert — tabela está vazia) ────────────
        insert_maps: list[dict] = []
        _now = datetime.utcnow()

        for row in df.to_dict('records'):
            tabela = _clean(row.get('TABELA'))
            job    = _clean(row.get('JOB'))
            grupo  = _clean(row.get('GRUPO'))
            if not tabela or not job or not grupo:
                continue

            maxqait_raw = _clean(row.get('MAXQAIT'))
            maxqait_val = int(maxqait_raw) if maxqait_raw and maxqait_raw.isdigit() else None
            tem_alerta  = str(row.get('TEM_ALERTA') or '').strip().upper() == 'SIM'

            insert_maps.append({
                'tabela':           tabela,
                'job':              job,
                'grupo':            grupo,
                'tasktype':         _clean(row.get('TASKTYPE')),
                'carga':            _clean(row.get('CARGA')),
                'horario_carga':    _clean(row.get('HORARIO_CARGA')),
                'isd':              _clean(row.get('ISD')),
                'evento_isd':       _clean(row.get('EVENTO_ISD')),
                'tem_alerta':       tem_alerta,
                'alerta_config':    _clean(row.get('ALERTA_CONFIG')),
                'tipo_alerta':      _clean(row.get('TIPO_ALERTA')),
                'padrao':           _clean(row.get('PADRAO')),
                'maxqait':          maxqait_val,
                'fromtime':         _clean(row.get('FROMTIME')),
                'untiltime':        _clean(row.get('UNTILTIME')),
                'confirm':          _clean(row.get('CONFIRM')),
                'memlib':           _clean(row.get('MEMLIB')),
                'resource':         _clean(row.get('RESOURCE')),
                'periodicidade':    _clean(row.get('PERIODICIDADE')),
                'calendario':       _clean(row.get('CALENDARIO')),
                'intersit':         _clean(row.get('INTERSIT')),
                'in_counds':        _clean(row.get('IN_COUNDS')),
                'out_counds':       _clean(row.get('OUT_COUNDS')),
                'comentario':       _clean(row.get('COMENTARIO')),
                'ambiente':         _clean(row.get('AMBIENTE')),
                'data_insercao':    _now,
                'data_atualizacao': _now,
            })

        logger.info(f'CTM: {len(insert_maps):,} registros a inserir')

        if insert_maps:
            db.bulk_insert_mappings(Processo, insert_maps)

        db.commit()
        logger.info(f'CTM ingerido: {len(insert_maps):,} registros')
        return len(insert_maps)

    except Exception as e:
        logger.error(f'Erro ao ingerir CTM: {e}')
        db.rollback()
        return 0
