import re
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, case, or_, and_, extract, text
from api.db.models import Processo, Execucao, Fluxo, ProcessoStats, ExecucaoTimeline
from datetime import datetime, timedelta
from typing import Optional, List

# Tabelas de controle: 2 letras + 2 dígitos no início (ex: PA12, PM11, PR21)
_CONTROL_RE = re.compile(r'^[A-Za-z]{2}\d{2}')

# Detecta datecode de fluxo REAL em IN_COUNDS (qualquer JB???/JOBNEXT exceto JBSTAT)
_FLOW_IN_RE  = re.compile(r'(?:JOBNEXT|JB(?!STAT)[A-Z0-9*]{4})', re.IGNORECASE)
# Detecta adição (+) de condição de fluxo real em OUT_COUNDS
# \s* tolera espaço antes do flag (formato produção: "JBODAT +")
_FLOW_OUT_RE = re.compile(r'(?:JOBNEXT|JB(?!STAT)[A-Z0-9*]{4})\s*\+', re.IGNORECASE)

# Parsers de condições individuais (mesmo padrão de gerar_fluxos.py)
# re.DOTALL: condições podem estar em linhas separadas em campos CSV multiline
_JBSTAT_RE    = re.compile(r'JBSTAT', re.IGNORECASE)
_OUT_PARSE_RE = re.compile(r'(.+?(?:JOBNEXT|JB[A-Z0-9*]{4}))\s*([+\-])', re.IGNORECASE | re.DOTALL)
_IN_PARSE_RE  = re.compile(r'.+?(?:JOBNEXT|JB[A-Z0-9*]{4})',              re.IGNORECASE | re.DOTALL)


def _jbodat_plus_conds(raw: str) -> list[str]:
    """Condições não-JBSTAT com flag + em OUT_COUNDS (candidatas a terem destino)."""
    if not raw:
        return []
    return [c.strip() for c, s in _OUT_PARSE_RE.findall(raw)
            if s == '+' and not _JBSTAT_RE.search(c)]


def _in_conds_list(raw: str) -> list[str]:
    """Todas as condições individuais em IN_COUNDS."""
    if not raw:
        return []
    return [m.strip() for m in _IN_PARSE_RE.findall(raw) if m.strip()]


# ══════════════════════════════════════════════════════════════════
# PROCESSOS
# ══════════════════════════════════════════════════════════════════

def _aplicar_filtros_processo(query, tabela=None, job=None, rotina=None, grupo_prefix=None,
                               periodicidade=None, tasktype=None, confirm=None, memlib=None,
                               carga=None, horarios_carga=None,
                               isd=None, evento_isd=None,
                               tem_alerta=None, padrao=None, tipo_alerta=None,
                               ambientes=None):
    if tabela:
        query = query.filter(Processo.tabela.ilike(f'%{tabela}%'))
    if job:
        query = query.filter(Processo.job.ilike(f'%{job}%'))
    if rotina:
        query = query.filter(func.left(Processo.tabela, 4) == rotina)
    if grupo_prefix:
        query = query.filter(Processo.grupo.like(f'{grupo_prefix}-%'))
    if periodicidade:
        query = query.filter(Processo.periodicidade == periodicidade)
    if tasktype:
        query = query.filter(Processo.tasktype == tasktype)
    if confirm == 'SIM':
        query = query.filter(Processo.confirm == 'Y')
    elif confirm == 'NAO':
        query = query.filter(or_(Processo.confirm == None, Processo.confirm == ''))
    if memlib:
        query = query.filter(Processo.memlib == memlib)
    if carga:
        query = query.filter(Processo.carga == carga)
    if horarios_carga:
        query = query.filter(Processo.horario_carga.in_(horarios_carga))
    if isd:
        query = query.filter(Processo.isd == isd)
    if evento_isd:
        query = query.filter(Processo.evento_isd == evento_isd)
    if tem_alerta is not None:
        query = query.filter(Processo.tem_alerta == tem_alerta)
    if padrao == 'SIM':
        query = query.filter(Processo.tipo_alerta == 'U-ECS')
    elif padrao == 'NAO':
        query = query.filter(Processo.tipo_alerta != 'U-ECS')
    if tipo_alerta:
        query = query.filter(Processo.tipo_alerta == tipo_alerta)
    if ambientes:
        query = query.filter(Processo.ambiente.in_(ambientes))
    return query


def get_processos(db: Session, skip=0, limit=20,
                  tabela=None, job=None, rotina=None, grupo_prefix=None,
                  periodicidade=None, tasktype=None, confirm=None, memlib=None,
                  carga=None, horarios_carga=None,
                  isd=None, evento_isd=None,
                  tem_alerta=None, padrao=None, tipo_alerta=None, ambientes=None):

    filtros = dict(tabela=tabela, job=job, rotina=rotina, grupo_prefix=grupo_prefix,
                   periodicidade=periodicidade, tasktype=tasktype, confirm=confirm, memlib=memlib,
                   carga=carga, horarios_carga=horarios_carga,
                   isd=isd, evento_isd=evento_isd,
                   tem_alerta=tem_alerta, padrao=padrao, tipo_alerta=tipo_alerta,
                   ambientes=ambientes)

    base = _aplicar_filtros_processo(db.query(Processo), **filtros)
    total = base.count()

    def _count_distinct_tabela(**extra):
        q = _aplicar_filtros_processo(db.query(Processo), **{**filtros, **extra})
        return q.with_entities(func.count(func.distinct(Processo.tabela))).scalar() or 0

    resumo = {
        'total_jobs':    total,
        'total_tabelas': base.with_entities(func.count(func.distinct(Processo.tabela))).scalar() or 0,
        'tabelas_carga': _count_distinct_tabela(carga='SIM'),
        'tabelas_isd':   _count_distinct_tabela(isd='SIM'),
        'tabelas_alerta': _count_distinct_tabela(tem_alerta=True),
        'jobs_alerta':   base.filter(Processo.tem_alerta == True).count(),
    }

    # Breakdown por ambiente — uma query GROUP BY extra
    _amb = base.with_entities(
        Processo.ambiente,
        func.count(Processo.id).label('jobs'),
        func.count(func.distinct(Processo.tabela)).label('tabelas'),
        func.count(func.distinct(case((Processo.carga == 'SIM', Processo.tabela)))).label('t_carga'),
        func.count(func.distinct(case((Processo.isd   == 'SIM', Processo.tabela)))).label('t_isd'),
        func.count(func.distinct(case((Processo.tem_alerta == True, Processo.tabela)))).label('t_alerta'),
        func.count(case((Processo.tem_alerta == True, Processo.id))).label('j_alerta'),
    ).group_by(Processo.ambiente).all()
    resumo['por_ambiente'] = {
        r.ambiente: {
            'total_jobs':    int(r.jobs),
            'total_tabelas': int(r.tabelas),
            'tabelas_carga': int(r.t_carga),
            'tabelas_isd':   int(r.t_isd),
            'tabelas_alerta':int(r.t_alerta),
            'jobs_alerta':   int(r.j_alerta),
        }
        for r in _amb if r.ambiente
    }

    processos = base.order_by(Processo.tabela, Processo.job).offset(skip).limit(limit).all()
    return {'processos': processos, 'total': total, 'resumo': resumo}


def get_processos_graficos(db: Session, tabela=None, job=None, rotina=None, grupo_prefix=None,
                            periodicidade=None, tasktype=None, confirm=None, memlib=None,
                            carga=None, isd=None, tem_alerta=None, ambientes=None):
    base = _aplicar_filtros_processo(
        db.query(Processo),
        tabela=tabela, job=job, rotina=rotina, grupo_prefix=grupo_prefix,
        periodicidade=periodicidade, tasktype=tasktype, confirm=confirm, memlib=memlib,
        carga=carga, isd=isd, tem_alerta=tem_alerta, ambientes=ambientes,
    )

    perio_rows = (
        base.with_entities(Processo.periodicidade, func.count(func.distinct(Processo.tabela)).label('total'))
        .filter(Processo.periodicidade != None)
        .group_by(Processo.periodicidade)
        .order_by(desc('total'))
        .all()
    )

    tabela_rows = (
        base.with_entities(Processo.tabela, func.count(Processo.id).label('total_jobs'))
        .group_by(Processo.tabela)
        .order_by(desc('total_jobs'))
        .all()
    )

    total_tab  = base.with_entities(func.count(func.distinct(Processo.tabela))).scalar() or 0
    carga_sim  = base.filter(Processo.carga  == 'SIM').with_entities(func.count(func.distinct(Processo.tabela))).scalar() or 0
    isd_sim    = base.filter(Processo.isd    == 'SIM').with_entities(func.count(func.distinct(Processo.tabela))).scalar() or 0
    total_jobs = base.with_entities(func.count(Processo.id)).scalar() or 0
    alerta_sim = base.filter(Processo.tem_alerta == True).with_entities(func.count(Processo.id)).scalar() or 0

    return {
        'periodicidades': [
            {'periodicidade': r.periodicidade or 'Indefinido', 'total': r.total}
            for r in perio_rows
        ],
        'jobs_por_tabela': [
            {'tabela': r.tabela, 'total_jobs': r.total_jobs}
            for r in tabela_rows
        ],
        'carga':   {'sim': carga_sim,  'nao': total_tab  - carga_sim,  'total': total_tab},
        'isd':     {'sim': isd_sim,    'nao': total_tab  - isd_sim,    'total': total_tab},
        'alertas': {'sim': alerta_sim, 'nao': total_jobs - alerta_sim, 'total': total_jobs},
    }


def get_processo_by_id(db: Session, tabela: str, job: str, grupo: str):
    return db.query(Processo).filter(
        Processo.tabela == tabela,
        Processo.job == job,
        Processo.grupo == grupo,
    ).first()


def get_periodicidades_disponiveis(db: Session) -> List[str]:
    rows = (db.query(Processo.periodicidade)
            .filter(Processo.periodicidade != None)
            .distinct().order_by(Processo.periodicidade).all())
    return [r[0] for r in rows if r[0]]


def get_tasktypes_disponiveis(db: Session) -> List[str]:
    rows = (db.query(Processo.tasktype)
            .filter(Processo.tasktype != None)
            .distinct().order_by(Processo.tasktype).all())
    return [r[0] for r in rows if r[0]]


# ══════════════════════════════════════════════════════════════════
# EXECUÇÕES
# ══════════════════════════════════════════════════════════════════

def _build_exec_filter(query, tabelas=None, jobs=None, grupos=None,
                        rotinas=None, data_inicio=None, data_fim=None, status=None,
                        ambientes=None):
    if tabelas:
        query = query.filter(or_(*[ExecucaoTimeline.tabela.ilike(f'%{t}%') for t in tabelas]))
    if jobs:
        query = query.filter(or_(*[ExecucaoTimeline.job.ilike(f'%{j}%') for j in jobs]))
    if grupos:
        query = query.filter(or_(*[ExecucaoTimeline.grupo.like(f'{g}-%') for g in grupos]))
    if rotinas:
        query = query.filter(func.left(ExecucaoTimeline.tabela, 4).in_(rotinas))
    if data_inicio:
        query = query.filter(ExecucaoTimeline.data_execucao >= data_inicio)
    if data_fim:
        fim = datetime.fromisoformat(data_fim) + timedelta(days=1)
        query = query.filter(ExecucaoTimeline.data_execucao < fim)
    if status:
        query = query.filter(ExecucaoTimeline.status == status)
    if ambientes:
        query = query.filter(ExecucaoTimeline.ambiente.in_(ambientes))
    return query


def get_execucoes(db: Session, skip=0, limit=20,
                  tabelas=None, jobs=None, grupos=None,
                  rotinas=None, data_inicio=None, data_fim=None, status=None,
                  ambientes=None):
    query = _build_exec_filter(
        db.query(ExecucaoTimeline),
        tabelas, jobs, grupos, rotinas, data_inicio, data_fim, status, ambientes,
    )
    total = query.count()
    execucoes = query.order_by(desc(ExecucaoTimeline.data_execucao)).offset(skip).limit(limit).all()
    return {'execucoes': execucoes, 'total': total}


def _build_cagg_where(tabelas, jobs, grupos, rotinas, data_inicio, data_fim, ambientes=None):
    """WHERE dinâmico para cagg_execucoes_dia com suporte a múltiplos valores."""
    parts: list[str] = []
    params: dict = {}

    if tabelas:
        subs = ' OR '.join(f'tabela ILIKE :t{i}' for i in range(len(tabelas)))
        parts.append(f'({subs})')
        for i, v in enumerate(tabelas):
            params[f't{i}'] = f'%{v}%'

    if jobs:
        subs = ' OR '.join(f'job ILIKE :j{i}' for i in range(len(jobs)))
        parts.append(f'({subs})')
        for i, v in enumerate(jobs):
            params[f'j{i}'] = f'%{v}%'

    if grupos:
        subs = ' OR '.join(f'grupo LIKE :g{i}' for i in range(len(grupos)))
        parts.append(f'({subs})')
        for i, v in enumerate(grupos):
            params[f'g{i}'] = f'{v}-%'

    if rotinas:
        subs = ' OR '.join(f"LEFT(tabela,4) = :r{i}" for i in range(len(rotinas)))
        parts.append(f'({subs})')
        for i, v in enumerate(rotinas):
            params[f'r{i}'] = v

    if data_inicio:
        parts.append('dia >= :dt_inicio')
        params['dt_inicio'] = data_inicio
    if data_fim:
        parts.append('dia < :dt_fim')
        params['dt_fim'] = (datetime.fromisoformat(data_fim) + timedelta(days=1)).isoformat()

    if ambientes:
        subs = ' OR '.join(f'ambiente = :a{i}' for i in range(len(ambientes)))
        parts.append(f'({subs})')
        for i, v in enumerate(ambientes):
            params[f'a{i}'] = v

    return (' AND '.join(parts) if parts else 'TRUE'), params


def _graficos_via_cagg(
    db: Session, base,
    tabelas, jobs, grupos, rotinas, data_inicio, data_fim, status, ambientes=None,
) -> dict:
    """
    Gera os dados dos gráficos consultando o Continuous Aggregate cagg_execucoes_dia.
    Resumo e volume diário são calculados a partir de dados pré-computados, sem
    tocar na hypertable de 58 M linhas. Raises se o cagg não estiver disponível.
    """
    where, params = _build_cagg_where(tabelas, jobs, grupos, rotinas, data_inicio, data_fim, ambientes)

    # ── Resumo: total/ok/nok/avg_dur do cagg ─────────────────────────────────
    # avg_dur ponderada por volume: SUM(avg_dur * total) / SUM(total)
    res = db.execute(text(f"""
        SELECT
            SUM(total)                                        AS total,
            SUM(ok)                                           AS ok,
            SUM(nok)                                          AS nok,
            SUM(avg_dur * total) / NULLIF(SUM(total), 0)     AS avg_dur,
            MAX(max_dur)                                      AS max_dur_global
        FROM cagg_execucoes_dia
        WHERE {where}
    """), params).fetchone()

    total_raw = int(res.total or 0)
    ok_raw    = int(res.ok   or 0)
    nok_raw   = int(res.nok  or 0)
    avg_dur   = float(res.avg_dur or 0)

    # Aplica filtro de status nos totais
    if status == 'OK':
        total_count, ok_count, nok_count = ok_raw, ok_raw, 0
    elif status == 'NOT OK':
        total_count, ok_count, nok_count = nok_raw, 0, nok_raw
    else:
        total_count, ok_count, nok_count = total_raw, ok_raw, nok_raw

    # Job com maior duração máxima
    top_job = db.execute(text(f"""
        SELECT job, MAX(max_dur) AS max_dur
        FROM cagg_execucoes_dia
        WHERE {where} AND max_dur IS NOT NULL
        GROUP BY job ORDER BY max_dur DESC LIMIT 1
    """), params).fetchone()

    # ── Volume por data (pré-computado) ──────────────────────────────────────
    vol_rows = db.execute(text(f"""
        SELECT
            dia::date  AS dt,
            SUM(total) AS total,
            SUM(ok)    AS ok,
            SUM(nok)   AS nok
        FROM cagg_execucoes_dia
        WHERE {where}
        GROUP BY dia
        HAVING SUM(total) > 0
        ORDER BY dia
    """), params).fetchall()

    def _vol_total(r):
        if status == 'OK':     return int(r.ok  or 0)
        if status == 'NOT OK': return int(r.nok or 0)
        return int(r.total or 0)

    # ── Top 10 por duração média (avg_dur do cagg é por todos os status) ─────
    top_dur = db.execute(text(f"""
        SELECT
            job,
            SUM(avg_dur * total) / NULLIF(SUM(total), 0)  AS avg_dur,
            MAX(max_dur)                                   AS max_dur
        FROM cagg_execucoes_dia
        WHERE {where} AND avg_dur IS NOT NULL
        GROUP BY job
        ORDER BY avg_dur DESC
        LIMIT 10
    """), params).fetchall()

    # ── Por hora: cagg é diário — query no hypertable (mais rápido que na tabela plana)
    hora_rows = (
        base.with_entities(
            extract('hour', ExecucaoTimeline.data_execucao).label('hora'),
            func.count(ExecucaoTimeline.id).label('total'),
            func.sum(case((ExecucaoTimeline.status == 'OK',     1), else_=0)).label('ok'),
            func.sum(case((ExecucaoTimeline.status == 'NOT OK', 1), else_=0)).label('nok'),
        )
        .group_by(extract('hour', ExecucaoTimeline.data_execucao))
        .order_by('hora')
        .all()
    )

    # Breakdown por ambiente
    _amb_res = db.execute(text(f"""
        SELECT ambiente,
               SUM(total)                                    AS total,
               SUM(ok)                                       AS ok,
               SUM(nok)                                      AS nok,
               SUM(avg_dur * total) / NULLIF(SUM(total), 0) AS avg_dur
        FROM cagg_execucoes_dia
        WHERE {where}
        GROUP BY ambiente
    """), params).fetchall()
    _por_amb = {
        r.ambiente: {
            'total':         int(r.total or 0),
            'ok':            int(r.ok    or 0),
            'nok':           int(r.nok   or 0),
            'duracao_media': round(float(r.avg_dur or 0), 2),
        }
        for r in _amb_res if r.ambiente
    }

    return {
        'resumo': {
            'total':              total_count,
            'ok':                 ok_count,
            'nok':                nok_count,
            'duracao_media':      round(avg_dur, 2),
            'job_maior_duracao':  top_job.job      if top_job else '-',
            'maior_duracao':      round(float(top_job.max_dur), 2) if top_job and top_job.max_dur else 0,
            'por_ambiente':       _por_amb,
        },
        'volume_por_data': [
            {'data': str(r.dt), 'total': _vol_total(r), 'ok': int(r.ok or 0), 'nok': int(r.nok or 0)}
            for r in vol_rows
        ],
        'top_duracao': [
            {'job': r.job,
             'avg_dur': round(float(r.avg_dur or 0), 2),
             'max_dur': round(float(r.max_dur or 0), 2)}
            for r in top_dur
        ],
        'por_hora': [
            {'hora': int(r.hora), 'total': r.total, 'ok': int(r.ok or 0), 'nok': int(r.nok or 0)}
            for r in hora_rows
        ],
    }


def _graficos_via_orm(db: Session, base, status) -> dict:
    """Fallback sem TimescaleDB: queries ORM direto na tabela/hypertable."""
    total    = base.count()
    ok_count = base.filter(ExecucaoTimeline.status == 'OK').count()
    nok_count = total - ok_count
    avg_dur   = base.with_entities(func.avg(ExecucaoTimeline.duracao_minutos)).scalar() or 0

    top_job_row = (
        base.with_entities(
            ExecucaoTimeline.job,
            func.max(ExecucaoTimeline.duracao_minutos).label('max_dur'),
        )
        .filter(ExecucaoTimeline.duracao_minutos != None)
        .group_by(ExecucaoTimeline.job)
        .order_by(desc('max_dur'))
        .first()
    )

    vol_rows = (
        base.with_entities(
            func.date(ExecucaoTimeline.data_execucao).label('dt'),
            func.count(ExecucaoTimeline.id).label('total'),
            func.sum(case((ExecucaoTimeline.status == 'OK',     1), else_=0)).label('ok'),
            func.sum(case((ExecucaoTimeline.status == 'NOT OK', 1), else_=0)).label('nok'),
        )
        .group_by(func.date(ExecucaoTimeline.data_execucao))
        .order_by(func.date(ExecucaoTimeline.data_execucao))
        .all()
    )

    top_dur_rows = (
        base.with_entities(
            ExecucaoTimeline.job,
            func.avg(ExecucaoTimeline.duracao_minutos).label('avg_dur'),
            func.max(ExecucaoTimeline.duracao_minutos).label('max_dur'),
        )
        .filter(ExecucaoTimeline.duracao_minutos != None)
        .group_by(ExecucaoTimeline.job)
        .order_by(desc('avg_dur'))
        .all()
    )

    hora_rows = (
        base.with_entities(
            extract('hour', ExecucaoTimeline.data_execucao).label('hora'),
            func.count(ExecucaoTimeline.id).label('total'),
            func.sum(case((ExecucaoTimeline.status == 'OK',     1), else_=0)).label('ok'),
            func.sum(case((ExecucaoTimeline.status == 'NOT OK', 1), else_=0)).label('nok'),
        )
        .group_by(extract('hour', ExecucaoTimeline.data_execucao))
        .order_by('hora')
        .all()
    )

    if status == 'OK':
        total_count, ok_count, nok_count = ok_count, ok_count, 0
    elif status == 'NOT OK':
        total_count, ok_count, nok_count = nok_count, 0, nok_count
    else:
        total_count = total

    return {
        'resumo': {
            'total':             total_count,
            'ok':                ok_count,
            'nok':               nok_count,
            'duracao_media':     round(float(avg_dur), 2),
            'job_maior_duracao': top_job_row.job if top_job_row else '-',
            'maior_duracao':     round(float(top_job_row.max_dur), 2) if top_job_row and top_job_row.max_dur else 0,
        },
        'volume_por_data': [
            {'data': str(r.dt), 'total': r.total, 'ok': int(r.ok or 0), 'nok': int(r.nok or 0)}
            for r in vol_rows
        ],
        'top_duracao': [
            {'job': r.job, 'avg_dur': round(float(r.avg_dur or 0), 2), 'max_dur': round(float(r.max_dur or 0), 2)}
            for r in top_dur_rows
        ],
        'por_hora': [
            {'hora': int(r.hora), 'total': r.total, 'ok': int(r.ok or 0), 'nok': int(r.nok or 0)}
            for r in hora_rows
        ],
    }


def get_execucoes_graficos(db: Session,
                            tabelas=None, jobs=None, grupos=None,
                            rotinas=None, data_inicio=None, data_fim=None,
                            status=None, ambientes=None):
    base = _build_exec_filter(
        db.query(ExecucaoTimeline),
        tabelas, jobs, grupos, rotinas, data_inicio, data_fim, status, ambientes,
    )

    # Caminho rápido: Continuous Aggregate (TimescaleDB)
    try:
        graficos = _graficos_via_cagg(
            db, base, tabelas, jobs, grupos, rotinas, data_inicio, data_fim, status, ambientes,
        )
    except Exception:
        # Fallback: queries ORM direto na tabela (sem TimescaleDB ou cagg vazio)
        graficos = _graficos_via_orm(db, base, status)

    # ── ISD e série temporal: sempre consultam o hypertable ──────────────────
    isd_base = (
        db.query(
            ExecucaoTimeline.job,
            func.count(ExecucaoTimeline.id).label('total'),
        )
        .join(Processo, and_(
            ExecucaoTimeline.tabela == Processo.tabela,
            ExecucaoTimeline.job    == Processo.job,
        ))
        .filter(Processo.isd == 'SIM')
    )
    if data_inicio:
        isd_base = isd_base.filter(ExecucaoTimeline.data_execucao >= data_inicio)
    if data_fim:
        fim = datetime.fromisoformat(data_fim) + timedelta(days=1)
        isd_base = isd_base.filter(ExecucaoTimeline.data_execucao < fim)
    if rotinas:
        isd_base = isd_base.filter(func.left(ExecucaoTimeline.tabela, 4).in_(rotinas))
    if grupos:
        isd_base = isd_base.filter(or_(*[ExecucaoTimeline.grupo.like(f'{g}-%') for g in grupos]))

    isd_rows = (
        isd_base.group_by(ExecucaoTimeline.job)
        .order_by(desc('total'))
        .all()
    )

    # Série temporal: só disponível quando exatamente 1 job é filtrado
    timeseries = []
    if jobs and len(jobs) == 1:
        ts_rows = (
            base.with_entities(
                ExecucaoTimeline.data_execucao,
                ExecucaoTimeline.duracao_minutos,
                ExecucaoTimeline.status,
            )
            .order_by(ExecucaoTimeline.data_execucao)
            .limit(500)
            .all()
        )
        timeseries = [
            {
                'data':    r.data_execucao.isoformat() if r.data_execucao else None,
                'duracao': float(r.duracao_minutos or 0),
                'status':  r.status,
            }
            for r in ts_rows
        ]

    return {
        **graficos,
        'isd_execucoes': [{'job': r.job, 'total': r.total} for r in isd_rows],
        'timeseries':    timeseries,
    }


def get_rotinas_disponiveis(db: Session) -> List[str]:
    rows = (
        db.query(func.left(ExecucaoTimeline.tabela, 4).label('rotina'))
        .distinct()
        .order_by('rotina')
        .all()
    )
    return [r.rotina for r in rows if r.rotina]


def get_jobs_sem_execucao(db: Session, limit: int = 50):
    """Jobs cadastrados no CTM que nunca apareceram no LOG de execuções."""
    rows = (
        db.query(
            Processo.tabela,
            Processo.job,
            Processo.grupo,
            Processo.periodicidade,
            Processo.carga,
        )
        .outerjoin(
            ExecucaoTimeline,
            and_(
                Processo.tabela == ExecucaoTimeline.tabela,
                Processo.job    == ExecucaoTimeline.job,
            ),
        )
        .filter(ExecucaoTimeline.tabela == None)
        .order_by(Processo.tabela, Processo.job)
        .limit(limit)
        .all()
    )
    return [
        {
            'tabela':        r.tabela,
            'job':           r.job,
            'grupo':         r.grupo,
            'periodicidade': r.periodicidade,
            'carga':         r.carga,
        }
        for r in rows
    ]


def get_alertas_nao_padrao(
    db: Session,
    tabela: str | None = None,
    job: str | None = None,
    rotina: str | None = None,
    grupo: str | None = None,
    tipo_alerta: str | None = None,
):
    """Jobs com alerta cujo tipo_alerta é diferente de 'U-ECS', com volume de execuções."""
    exec_sub = (
        db.query(
            ExecucaoTimeline.tabela,
            ExecucaoTimeline.job,
            func.count(ExecucaoTimeline.id).label('total_exec'),
        )
        .group_by(ExecucaoTimeline.tabela, ExecucaoTimeline.job)
        .subquery()
    )
    q = (
        db.query(
            Processo.tabela,
            Processo.job,
            Processo.grupo,
            Processo.tipo_alerta,
            func.coalesce(exec_sub.c.total_exec, 0).label('total_exec'),
        )
        .outerjoin(exec_sub, and_(
            Processo.tabela == exec_sub.c.tabela,
            Processo.job    == exec_sub.c.job,
        ))
        .filter(Processo.tem_alerta == True)
        .filter(or_(Processo.tipo_alerta == None, Processo.tipo_alerta != 'U-ECS'))
    )
    if tabela:
        q = q.filter(Processo.tabela.ilike(f'%{tabela}%'))
    if job:
        q = q.filter(Processo.job.ilike(f'%{job}%'))
    if rotina:
        q = q.filter(func.left(Processo.tabela, 4) == rotina)
    if grupo:
        q = q.filter(Processo.grupo.like(f'{grupo}-%'))
    if tipo_alerta:
        q = q.filter(Processo.tipo_alerta == tipo_alerta)
    rows = q.order_by(desc('total_exec')).all()
    return [
        {
            'tabela':      r.tabela,
            'job':         r.job,
            'grupo':       r.grupo,
            'tipo_alerta': r.tipo_alerta or '(sem tipo)',
            'total_exec':  int(r.total_exec),
        }
        for r in rows
    ]


def get_sla_jobs(db: Session, sla_minutos: float = 30.0,
                 tabelas=None, jobs=None, grupos=None, rotinas=None,
                 data_inicio=None, data_fim=None, ambientes=None):
    """Jobs cuja duração média excede o limiar de SLA configurável."""
    base = (
        db.query(
            ExecucaoTimeline.tabela,
            ExecucaoTimeline.job,
            ExecucaoTimeline.grupo,
            func.avg(ExecucaoTimeline.duracao_minutos).label('avg_dur'),
            func.max(ExecucaoTimeline.duracao_minutos).label('max_dur'),
            func.count(ExecucaoTimeline.id).label('total_exec'),
        )
        .filter(ExecucaoTimeline.duracao_minutos != None)
    )
    base = _build_exec_filter(base, tabelas, jobs, grupos, rotinas, data_inicio, data_fim, ambientes=ambientes)
    rows = (
        base
        .group_by(ExecucaoTimeline.tabela, ExecucaoTimeline.job, ExecucaoTimeline.grupo)
        .having(func.avg(ExecucaoTimeline.duracao_minutos) > sla_minutos)
        .order_by(desc('avg_dur'))
        .all()
    )
    return [
        {
            'tabela':     r.tabela,
            'job':        r.job,
            'grupo':      r.grupo or '',
            'avg_dur':    round(float(r.avg_dur), 2),
            'max_dur':    round(float(r.max_dur), 2),
            'total_exec': int(r.total_exec),
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════
# STATS
# ══════════════════════════════════════════════════════════════════

def get_stats_processo(db: Session, tabela: str, job: str, grupo: str):
    return db.query(ProcessoStats).filter(
        ProcessoStats.tabela == tabela,
        ProcessoStats.job    == job,
        ProcessoStats.grupo  == grupo,
    ).first()


def get_stats_dashboard(db: Session):
    total_processos  = db.query(func.count(Processo.id)).scalar()
    total_execucoes  = db.query(func.count(ExecucaoTimeline.id)).scalar()
    execucoes_sucesso = db.query(func.count(ExecucaoTimeline.id)).filter(
        ExecucaoTimeline.status == 'OK'
    ).scalar()
    taxa_sucesso = (execucoes_sucesso / total_execucoes * 100) if total_execucoes > 0 else 0
    return {
        'total_processos': total_processos,
        'total_execucoes': total_execucoes,
        'taxa_sucesso': taxa_sucesso,
    }


# ══════════════════════════════════════════════════════════════════
# FLUXOS
# ══════════════════════════════════════════════════════════════════

def _posicao_fluxo(p: Processo) -> str:
    """
    Classifica a posição do job no fluxo ignorando condições JBSTAT (semáforos
    de controle de ciclo). Apenas condições datadas (JBODAT, JBPREV, JOBNEXT,
    JB????) representam dependências reais de fluxo.
    """
    has_real_in  = bool(_FLOW_IN_RE.search(p.in_counds  or ''))
    has_real_out = bool(_FLOW_OUT_RE.search(p.out_counds or ''))
    if not has_real_in:
        return 'inicio'
    if not has_real_out:
        return 'fim'
    return 'meio'


def get_rotinas_processos(db: Session) -> List[str]:
    rows = (
        db.query(func.left(Processo.tabela, 4).label('rotina'))
        .distinct().order_by('rotina').all()
    )
    return [r.rotina for r in rows if r.rotina]


_MAX_GRAPH_NODES = 1000


# ══════════════════════════════════════════════════════════════════
# DESVIO DE VOLUMETRIA
# ══════════════════════════════════════════════════════════════════

def get_desvio_volumetria(db: Session, threshold_pct: float = 50.0,
                           tabelas=None, jobs=None, grupos=None, rotinas=None,
                           data_inicio=None, data_fim=None, ambientes=None) -> list:
    """Compara execuções do período recente vs. baseline anterior, com suporte a filtros."""
    cagg_where, cagg_params = _build_cagg_where(tabelas, jobs, grupos, rotinas, data_inicio, data_fim, ambientes)
    params = {'threshold': threshold_pct, **cagg_params}

    rows = db.execute(text(f"""
        WITH max_dia AS (
            SELECT MAX(dia)::date AS ultimo FROM cagg_execucoes_dia
            WHERE {cagg_where}
        ),
        total_dias AS (
            SELECT COUNT(DISTINCT dia::date) AS n FROM cagg_execucoes_dia
            WHERE {cagg_where}
        ),
        corte AS (
            SELECT GREATEST(1, LEAST(7, ROUND(n * 0.3)::int)) AS janela_recente
            FROM total_dias
        ),
        daily AS (
            SELECT tabela, job, MIN(grupo) AS grupo, dia::date AS dia, SUM(total) AS execucoes
            FROM cagg_execucoes_dia
            WHERE {cagg_where}
            GROUP BY tabela, job, dia::date
        ),
        recente AS (
            SELECT d.tabela, d.job, d.grupo, d.dia, d.execucoes
            FROM daily d, max_dia m, corte c
            WHERE d.dia > m.ultimo - c.janela_recente
        ),
        historico AS (
            SELECT d.tabela, d.job, AVG(d.execucoes)::numeric AS media
            FROM daily d, max_dia m, corte c
            WHERE d.dia <= m.ultimo - c.janela_recente
            GROUP BY d.tabela, d.job
            HAVING COUNT(*) >= 1
        )
        SELECT
            r.tabela, r.job, r.grupo, r.dia::text AS dia, r.execucoes AS observado,
            ROUND(h.media, 1) AS baseline,
            ROUND((r.execucoes - h.media) / NULLIF(h.media, 0) * 100, 1) AS desvio_pct
        FROM recente r
        JOIN historico h USING (tabela, job)
        WHERE ABS((r.execucoes - h.media) / NULLIF(h.media, 0)) * 100 >= :threshold
        ORDER BY ABS((r.execucoes - h.media) / NULLIF(h.media, 0)) DESC
        LIMIT 200
    """), params).fetchall()

    return [
        {
            'tabela':     r.tabela,
            'job':        r.job,
            'grupo':      r.grupo or '',
            'dia':        r.dia,
            'observado':  int(r.observado),
            'baseline':   float(r.baseline or 0),
            'desvio_pct': float(r.desvio_pct or 0),
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════
# TENDÊNCIA DE DURAÇÃO
# ══════════════════════════════════════════════════════════════════

def get_tendencia_duracao(db: Session,
                          tabelas=None, jobs=None, grupos=None, rotinas=None,
                          data_inicio=None, data_fim=None, ambientes=None) -> list:
    """Compara duração média da última semana vs. semanas anteriores via time_bucket.
    Retorna jobs com variação acima de 30%, com suporte a filtros."""
    from collections import defaultdict

    cagg_where, cagg_params = _build_cagg_where(tabelas, jobs, grupos, rotinas, data_inicio, data_fim, ambientes)

    rows = db.execute(text(f"""
        SELECT
            tabela, job, MIN(grupo) AS grupo,
            time_bucket('7 days', dia)::date AS semana,
            ROUND((SUM(avg_dur * total) / NULLIF(SUM(total), 0))::numeric, 2) AS avg_dur,
            SUM(total) AS total_exec
        FROM cagg_execucoes_dia
        WHERE avg_dur IS NOT NULL AND total > 0 AND ({cagg_where})
        GROUP BY tabela, job, time_bucket('7 days', dia)
        ORDER BY tabela, job, semana
    """), cagg_params).fetchall()

    series_map: dict = defaultdict(list)
    grupo_map:  dict = {}
    for r in rows:
        key = (r.tabela, r.job)
        grupo_map[key] = r.grupo or ''
        series_map[key].append({
            'semana':  str(r.semana),
            'avg_dur': float(r.avg_dur or 0),
            'total':   int(r.total_exec),
        })

    resultado = []
    for (tabela, job), series in series_map.items():
        if len(series) < 2:
            continue
        dur_ultima = series[-1]['avg_dur']
        dur_hist   = sum(s['avg_dur'] for s in series[:-1]) / (len(series) - 1)
        if dur_hist <= 0:
            continue
        var_pct = (dur_ultima - dur_hist) / dur_hist * 100
        if var_pct > 30:
            resultado.append({
                'tabela':        tabela,
                'job':           job,
                'grupo':         grupo_map.get((tabela, job), ''),
                'dur_ultima':    round(dur_ultima, 2),
                'dur_historico': round(dur_hist,   2),
                'variacao_pct':  round(var_pct,    1),
                'semanas':       series,
            })

    resultado.sort(key=lambda x: x['variacao_pct'], reverse=True)
    return resultado[:50]


# ══════════════════════════════════════════════════════════════════
# MÚLTIPLAS EXECUÇÕES POR DIA
# ══════════════════════════════════════════════════════════════════

def get_execucoes_multiplas_por_dia(
    db: Session,
    tabelas=None, jobs=None, grupos=None, rotinas=None,
    data_inicio=None, data_fim=None, ambientes=None,
) -> list:
    where_parts = ['1=1']
    params: dict = {}

    if tabelas:
        ph = ', '.join(f':t{i}' for i in range(len(tabelas)))
        where_parts.append(f'tabela IN ({ph})')
        params.update({f't{i}': v for i, v in enumerate(tabelas)})
    if jobs:
        ph = ', '.join(f':j{i}' for i in range(len(jobs)))
        where_parts.append(f'job IN ({ph})')
        params.update({f'j{i}': v for i, v in enumerate(jobs)})
    if grupos:
        ph = ', '.join(f':g{i}' for i in range(len(grupos)))
        where_parts.append(f'SUBSTRING(grupo, 1, 4) IN ({ph})')
        params.update({f'g{i}': v for i, v in enumerate(grupos)})
    if rotinas:
        ph = ', '.join(f':r{i}' for i in range(len(rotinas)))
        where_parts.append(f'SUBSTRING(tabela, 1, 4) IN ({ph})')
        params.update({f'r{i}': v for i, v in enumerate(rotinas)})
    if data_inicio:
        where_parts.append('DATE(data_execucao) >= :data_inicio')
        params['data_inicio'] = data_inicio
    if data_fim:
        where_parts.append('DATE(data_execucao) <= :data_fim')
        params['data_fim'] = data_fim
    if ambientes:
        ph = ', '.join(f':ma{i}' for i in range(len(ambientes)))
        where_parts.append(f'ambiente IN ({ph})')
        params.update({f'ma{i}': v for i, v in enumerate(ambientes)})

    where = ' AND '.join(where_parts)

    sql = f"""
    WITH diario AS (
        SELECT
            tabela,
            MIN(grupo) AS grupo,
            DATE(data_execucao) AS dia,
            COUNT(*) AS execucoes_no_dia
        FROM mat_execucoes_timeline
        WHERE {where}
        GROUP BY tabela, DATE(data_execucao)
        HAVING COUNT(*) > 1
    )
    SELECT
        tabela,
        grupo,
        COUNT(*)              AS dias_com_multiplas,
        MAX(execucoes_no_dia) AS max_execucoes_dia,
        SUM(execucoes_no_dia) AS total_execucoes
    FROM diario
    GROUP BY tabela, grupo
    ORDER BY max_execucoes_dia DESC, dias_com_multiplas DESC
    LIMIT 100
    """

    rows = db.execute(text(sql), params).fetchall()
    return [
        {
            'tabela':            r.tabela,
            'grupo':             r.grupo or '',
            'dias_com_multiplas': int(r.dias_com_multiplas),
            'max_execucoes_dia': int(r.max_execucoes_dia),
            'total_execucoes':   int(r.total_execucoes),
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════
# JANELA DE CARGA
# ══════════════════════════════════════════════════════════════════

_CTM_CUTOVER_H = 7   # virada de data CTM às 07h00


def get_janela_carga(db: Session, dias: int = 7,
                     tabelas=None, rotinas=None, horarios=None, grupos=None) -> list:
    """Compara horario_carga (CTM) com o primeiro início real da tabela (LOG).

    Regras de negócio:
    - Uma tabela só pode estar no prazo ou atrasada — nunca adiantada.
    - Exibe apenas a ÚLTIMA data de execução de cada tabela (sem repetição).
    - Delta sempre ≥ 0; considera a virada CTM às 07h00 para cruzamentos de meia-noite.
    """
    # Filtros dinâmicos para raw_processos
    where_parts = [
        "carga = 'SIM'",
        "horario_carga IS NOT NULL",
        "horario_carga ~ '^[0-9]+$'",
    ]
    params: dict = {'dias': dias}

    if tabelas:
        where_parts.append("tabela ILIKE ANY(:tab_filtros)")
        params['tab_filtros'] = [f'%{t}%' for t in tabelas]
    if rotinas:
        where_parts.append("SUBSTRING(tabela, 1, 4) = ANY(:rot_filtros)")
        params['rot_filtros'] = rotinas
    if horarios:
        where_parts.append("horario_carga::int = ANY(:horarios_int)")
        params['horarios_int'] = [int(h) for h in horarios]
    if grupos:
        where_parts.append("SUBSTRING(grupo, 1, 4) = ANY(:grup_filtros)")
        params['grup_filtros'] = grupos

    where_carga = ' AND '.join(where_parts)

    rows = db.execute(text(f"""
        WITH carga AS (
            -- Tabelas com horário de carga programado
            SELECT tabela, MIN(horario_carga::int) AS hora_programada, MIN(grupo) AS grupo
            FROM raw_processos
            WHERE {where_carga}
            GROUP BY tabela
        ),
        ultimo_dia AS (
            -- Último dia de execução de cada tabela (sem filtro de data — sempre pega o mais recente)
            SELECT e.tabela, MAX(DATE(e.data_execucao)) AS dia
            FROM mat_execucoes_timeline e
            JOIN carga c ON e.tabela = c.tabela
            GROUP BY e.tabela
        ),
        primeiros AS (
            -- Primeiro início nesse último dia
            SELECT e.tabela, MIN(e.data_execucao) AS primeiro_inicio
            FROM mat_execucoes_timeline e
            JOIN ultimo_dia u ON e.tabela = u.tabela
                              AND DATE(e.data_execucao) = u.dia
            GROUP BY e.tabela
        )
        SELECT
            c.tabela,
            c.hora_programada,
            c.grupo,
            DATE(p.primeiro_inicio)::text             AS dia,
            p.primeiro_inicio,
            EXTRACT(HOUR   FROM p.primeiro_inicio)::int AS hora_real,
            EXTRACT(MINUTE FROM p.primeiro_inicio)::int AS min_real
        FROM primeiros p
        JOIN carga c USING (tabela)
    """), params).fetchall()

    resultado = []
    for r in rows:
        scheduled_min = int(r.hora_programada) * 60
        actual_min    = int(r.hora_real) * 60 + int(r.min_real)
        delta         = actual_min - scheduled_min

        # Cruzamento de meia-noite: job noturno (ex: prev 23h00, exec 00h10)
        # Threshold = virada CTM × 60; se delta ficar abaixo disso, somamos 1440
        if delta < -(_CTM_CUTOVER_H * 60):
            delta += 1440

        # Tabela nunca pode adiantar — delta mínimo é 0
        delta = max(0, delta)

        resultado.append({
            'tabela':          r.tabela,
            'hora_programada': int(r.hora_programada),
            'grupo':           r.grupo or '',
            'dia':             r.dia,
            'primeiro_inicio': r.primeiro_inicio.isoformat() if r.primeiro_inicio else None,
            'hora_real':       int(r.hora_real),
            'min_real':        int(r.min_real),
            'delta_minutos':   delta,
            'status':          'atrasada' if delta > 30 else 'no_prazo',
        })

    resultado.sort(key=lambda x: x['delta_minutos'], reverse=True)
    return resultado


# ══════════════════════════════════════════════════════════════════
# ANÁLISE PREDITIVA
# ══════════════════════════════════════════════════════════════════

def get_historico_job_duracao(db: Session, tabela: str, job: str) -> list:
    """Retorna histórico diário de duração de um job para treinar o preditor."""
    rows = db.execute(text("""
        SELECT dia::date AS data,
               ROUND(avg_dur::numeric, 2) AS duracao,
               total, ok, nok
        FROM cagg_execucoes_dia
        WHERE tabela = :tabela AND job = :job
          AND avg_dur IS NOT NULL AND total > 0
        ORDER BY dia
    """), {'tabela': tabela, 'job': job}).fetchall()
    return [
        {
            'data':    str(r.data),
            'duracao': float(r.duracao or 0),
            'total':   int(r.total),
            'ok':      int(r.ok),
            'nok':     int(r.nok),
        }
        for r in rows
    ]


def get_inicio_medio_jobs_batch(db: Session, job_keys: list) -> dict:
    """Retorna horário médio de início (min desde meia-noite) para lista de (tabela, job)."""
    if not job_keys:
        return {}
    tabelas = list({t for t, _ in job_keys})
    jobs_   = list({j for _, j in job_keys})
    rows = db.execute(text("""
        SELECT tabela, job,
               AVG(EXTRACT(HOUR   FROM data_execucao) * 60
                 + EXTRACT(MINUTE FROM data_execucao)) AS inicio_medio
        FROM mat_execucoes_timeline
        WHERE tabela = ANY(:tabs) AND job = ANY(:jobs)
        GROUP BY tabela, job
    """), {'tabs': tabelas, 'jobs': jobs_}).fetchall()
    return {
        (r.tabela, r.job): float(r.inicio_medio)
        for r in rows if r.inicio_medio is not None
    }


def get_fluxos_downstream(db: Session, tabela: str, job: str) -> tuple:
    """BFS a partir de (tabela, job) para encontrar todos os jobs downstream.
    Retorna (subgraph_adj, all_jobs_set)."""
    all_fluxos = db.query(Fluxo).all()
    adj: dict = {}
    for f in all_fluxos:
        src  = (f.tabela_origem, f.job_origem)
        dest = (f.tabela_destino, f.job_destino)
        adj.setdefault(src, []).append(dest)

    start   = (tabela, job)
    visited = {start}
    queue   = [start]
    subgraph: dict = {}

    while queue:
        cur       = queue.pop(0)
        neighbors = adj.get(cur, [])
        subgraph[cur] = neighbors
        for dest in neighbors:
            if dest not in visited:
                visited.add(dest)
                queue.append(dest)

    return subgraph, visited


def get_caminho_entre_jobs(db: Session, tab_orig: str, job_orig: str,
                           tab_dest: str, job_dest: str) -> list | None:
    """Encontra o caminho mais curto (BFS) entre dois jobs no grafo de fluxos.
    Retorna lista de (tabela, job) do início ao fim, ou None se não existe caminho."""
    from collections import deque

    all_fluxos = db.query(Fluxo).all()
    adj: dict = {}
    for f in all_fluxos:
        src  = (f.tabela_origem,  f.job_origem)
        dest = (f.tabela_destino, f.job_destino)
        adj.setdefault(src, []).append(dest)

    start = (tab_orig, job_orig)
    end   = (tab_dest, job_dest)

    if start == end:
        return [start]

    # BFS com predecessor — eficiente para grafos grandes
    pred: dict = {start: None}
    queue = deque([start])

    while queue:
        cur = queue.popleft()
        for neighbor in adj.get(cur, []):
            if neighbor not in pred:
                pred[neighbor] = cur
                if neighbor == end:
                    # Reconstrói o caminho
                    path = []
                    node = end
                    while node is not None:
                        path.append(node)
                        node = pred[node]
                    path.reverse()
                    return path
                queue.append(neighbor)

    return None


def buscar_jobs(db: Session, q: str, limit: int = 30) -> list:
    """Busca jobs com histórico de execução para autocomplete."""
    rows = db.execute(text("""
        SELECT DISTINCT tabela, job
        FROM mat_execucoes_timeline
        WHERE tabela ILIKE :q OR job ILIKE :q
        ORDER BY tabela, job
        LIMIT :lim
    """), {'q': f'%{q}%', 'lim': limit}).fetchall()
    return [{'tabela': r.tabela, 'job': r.job} for r in rows]


def get_fluxos_grafo(db: Session, grupos=None, tabelas=None, jobs=None,
                     rotinas=None, ambientes=None, posicao=None, carga=None,
                     horario_carga=None, controle=None):
    # 1. Filtrar processos
    q = db.query(Processo)
    if grupos:
        q = q.filter(or_(*[Processo.grupo.like(f'{g}-%') for g in grupos]))
    if tabelas:
        q = q.filter(or_(*[Processo.tabela.ilike(f'%{t}%') for t in tabelas]))
    if jobs:
        q = q.filter(or_(*[Processo.job.ilike(f'%{j}%') for j in jobs]))
    if rotinas:
        q = q.filter(func.left(Processo.tabela, 4).in_(rotinas))
    if ambientes:
        q = q.filter(Processo.ambiente.in_(ambientes))
    if carga:
        q = q.filter(Processo.carga == carga)
    if horario_carga:
        q = q.filter(Processo.horario_carga == horario_carga)

    processos = q.all()

    # 2. Classificação inicial de posição por campos do próprio processo
    pos_map = {(p.tabela, p.job): _posicao_fluxo(p) for p in processos}

    # 3. Carregar todos os fluxos e montar mapa de saídas por nó
    all_fluxos = db.query(Fluxo).all()
    outgoing_map: dict[str, list[tuple[str, str]]] = {}
    for f in all_fluxos:
        src = f"{f.tabela_origem}_{f.job_origem}"
        outgoing_map.setdefault(src, []).append((f.tabela_destino, f.job_destino))

    # 4. Reclassificar "meio" → "fim" quando TODAS as saídas vão para tabelas de controle
    #    (job produtivo que só notifica scheduler — ex: envia JBODAT+ apenas para PA12)
    for (tab, jb), pos in list(pos_map.items()):
        if pos == 'meio':
            node_id  = f"{tab}_{jb}"
            outgoing = outgoing_map.get(node_id, [])
            if outgoing and all(_CONTROL_RE.match(t) for t, _ in outgoing):
                pos_map[(tab, jb)] = 'fim'

    # 5. Filtrar por posicao se solicitado
    if posicao:
        pos_map = {k: v for k, v in pos_map.items() if v == posicao}

    filtered_keys = set(pos_map.keys())

    # 6. Conjunto global de condições consumidas em IN_COUNDS (para detectar órfãs)
    all_in_rows = db.query(Processo.in_counds).filter(Processo.in_counds != None).all()
    indice_in_global: set[str] = set()
    for (raw,) in all_in_rows:
        for cond in _in_conds_list(raw):
            indice_in_global.add(cond)

    # 7. Montar nós com status de controle e condições órfãs
    nodes = []
    for p in processos:
        if (p.tabela, p.job) not in filtered_keys:
            continue
        node_id = f"{p.tabela}_{p.job}"
        pos     = pos_map[(p.tabela, p.job)]

        controle_efetuado   = False
        suscetivel_controle = False
        if p.carga == 'SIM':
            outgoing      = outgoing_map.get(node_id, [])
            to_control    = [(t, j) for t, j in outgoing if _CONTROL_RE.match(t)]
            to_productive = [(t, j) for t, j in outgoing if not _CONTROL_RE.match(t)]
            is_prod_fim   = (pos == 'fim') or (pos == 'meio' and not to_productive)
            if is_prod_fim:
                controle_efetuado   = bool(to_control)
                suscetivel_controle = not bool(to_control)

        # Condições JBODAT+ que não aparecem em IN_COUNDS de nenhum job no banco
        condicoes_orfas = [c for c in _jbodat_plus_conds(p.out_counds or '')
                           if c not in indice_in_global]

        nodes.append({
            'id':                   node_id,
            'label':                p.job,
            'grupo':                p.grupo,
            'tabela':               p.tabela,
            'posicao':              pos,
            'carga':                p.carga or '',
            'horario_carga':        p.horario_carga or '',
            'in_counds':            p.in_counds  or '',
            'out_counds':           p.out_counds or '',
            'controle_efetuado':    controle_efetuado,
            'suscetivel_controle':  suscetivel_controle,
            'condicoes_orfas':      condicoes_orfas,
        })

    # 5. Filtrar por controle se solicitado
    if controle == 'efetuado':
        nodes = [n for n in nodes if n['controle_efetuado']]
    elif controle == 'suscetivel':
        nodes = [n for n in nodes if n['suscetivel_controle']]

    if not nodes:
        return {'nodes': [], 'edges': []}

    if len(nodes) > _MAX_GRAPH_NODES:
        raise ValueError(
            f"O filtro retornou {len(nodes)} nós. "
            f"Refine os filtros (Rotina, Grupo ou Tabela) para exibir no máximo {_MAX_GRAPH_NODES} nós."
        )

    # 8. Último status de execução por nó (label = nome do job)
    tab_set = list({n['tabela'] for n in nodes})
    job_set = list({n['label']  for n in nodes})
    ult_exec = {
        (r.tabela, r.job): r.status
        for r in db.execute(text("""
            SELECT DISTINCT ON (tabela, job) tabela, job, status
            FROM mat_execucoes_timeline
            WHERE tabela = ANY(:tabs) AND job = ANY(:jobs)
            ORDER BY tabela, job, data_execucao DESC
        """), {'tabs': tab_set, 'jobs': job_set}).fetchall()
    }
    for n in nodes:
        n['ultimo_status'] = ult_exec.get((n['tabela'], n['label']))

    node_ids = {n['id'] for n in nodes}

    # 6. Arestas entre nós do conjunto filtrado
    edges = [
        {
            'source':   f"{f.tabela_origem}_{f.job_origem}",
            'target':   f"{f.tabela_destino}_{f.job_destino}",
            'condicao': f.condicao or '',
        }
        for f in all_fluxos
        if f"{f.tabela_origem}_{f.job_origem}" in node_ids
        and f"{f.tabela_destino}_{f.job_destino}" in node_ids
    ]

    return {'nodes': nodes, 'edges': edges}
