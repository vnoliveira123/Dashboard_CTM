from fastapi import APIRouter, Query, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from api.db.database import get_db
from api.db.queries import (
    get_processos, get_processos_graficos, get_stats_processo,
    get_stats_dashboard, get_periodicidades_disponiveis, get_tasktypes_disponiveis,
    get_rotinas_processos, get_jobs_sem_execucao, get_alertas_nao_padrao,
    get_janela_carga,
)
from api.middleware.cache import get_or_cache
from typing import Optional, List
import io
import csv

router = APIRouter()


@router.get("/filtros")
async def listar_opcoes_filtro(db: Session = Depends(get_db)):
    return get_or_cache(
        "cache:processos:filtros", 600,
        lambda: {
            "periodicidades": get_periodicidades_disponiveis(db),
            "tasktypes": get_tasktypes_disponiveis(db),
            "rotinas": get_rotinas_processos(db),
        },
    )


@router.get("/graficos")
async def obter_graficos_processos(
    tabela: Optional[str] = Query(None),
    job: Optional[str] = Query(None),
    rotina: Optional[str] = Query(None),
    grupo: Optional[str] = Query(None),
    periodicidade: Optional[str] = Query(None),
    tasktype: Optional[str] = Query(None),
    confirm: Optional[str] = Query(None),
    memlib: Optional[str] = Query(None),
    carga: Optional[str] = Query(None),
    isd: Optional[str] = Query(None),
    tem_alerta: Optional[str] = Query(None),
    ambiente: List[str] = Query(default=[]),
    db: Session = Depends(get_db),
):
    tem_alerta_bool = None
    if tem_alerta == 'SIM':  tem_alerta_bool = True
    elif tem_alerta == 'NAO': tem_alerta_bool = False

    return get_processos_graficos(
        db, tabela=tabela, job=job, rotina=rotina, grupo_prefix=grupo,
        periodicidade=periodicidade, tasktype=tasktype, confirm=confirm,
        memlib=memlib, carga=carga, isd=isd, tem_alerta=tem_alerta_bool,
        ambientes=ambiente or None,
    )


@router.get("/sem-execucao")
async def listar_jobs_sem_execucao(
    limit:    int           = Query(50, ge=1, le=200),
    tabela:   Optional[str] = Query(None),
    job:      Optional[str] = Query(None),
    grupo:    Optional[str] = Query(None),
    rotina:   Optional[str] = Query(None),
    carga:    Optional[str] = Query(None),
    isd:      Optional[str] = Query(None),
    ambiente: List[str]     = Query(default=[]),
    db: Session = Depends(get_db),
):
    cache_key = (
        f"cache:processos:sem-execucao:{limit}"
        f":{tabela or ''}:{job or ''}:{grupo or ''}:{rotina or ''}"
        f":{carga or ''}:{isd or ''}:{','.join(sorted(ambiente))}"
    )
    def _fetch():
        jobs = get_jobs_sem_execucao(
            db, limit=limit,
            tabela=tabela, job=job, grupo=grupo, rotina=rotina,
            carga=carga, isd=isd, ambientes=ambiente or None,
        )
        return {"jobs": jobs, "total": len(jobs)}
    return get_or_cache(cache_key, 600, _fetch)


@router.get("/janela-carga")
async def obter_janela_carga(
    dias:           int           = Query(7,    ge=1, le=90),
    tabela:         Optional[str] = Query(None),
    rotina:         Optional[str] = Query(None),
    grupo:          Optional[str] = Query(None),
    horarios_carga: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Compara horário de carga programado (CTM) com o primeiro início real de cada tabela."""
    tabelas  = [tabela] if tabela else None
    rotinas  = [rotina] if rotina else None
    grupos   = [grupo]  if grupo  else None
    horarios = [h.strip() for h in horarios_carga.split(',') if h.strip()] if horarios_carga else None
    rows = get_janela_carga(db, dias=dias, tabelas=tabelas, rotinas=rotinas, horarios=horarios, grupos=grupos)
    return {"janela": rows}


@router.get("/alertas-nao-padrao")
async def listar_alertas_nao_padrao(
    tabela:      Optional[str] = Query(None),
    job:         Optional[str] = Query(None),
    rotina:      Optional[str] = Query(None),
    grupo:       Optional[str] = Query(None),
    tipo_alerta: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    cache_key = (
        f"cache:processos:alertas-nao-padrao"
        f":{tabela or ''}:{job or ''}:{rotina or ''}:{grupo or ''}:{tipo_alerta or ''}"
    )
    return get_or_cache(
        cache_key, 600,
        lambda: {"alertas": get_alertas_nao_padrao(
            db, tabela=tabela, job=job, rotina=rotina, grupo=grupo, tipo_alerta=tipo_alerta,
        )},
    )


@router.get("/exportar")
async def exportar_processos(
    tabela: Optional[str] = Query(None),
    job: Optional[str] = Query(None),
    rotina: Optional[str] = Query(None),
    grupo: Optional[str] = Query(None),
    periodicidade: Optional[str] = Query(None),
    tasktype: Optional[str] = Query(None),
    confirm: Optional[str] = Query(None),
    memlib: Optional[str] = Query(None),
    carga: Optional[str] = Query(None),
    horarios_carga: Optional[str] = Query(None),
    isd: Optional[str] = Query(None),
    evento_isd: Optional[str] = Query(None),
    tem_alerta: Optional[str] = Query(None),
    padrao: Optional[str] = Query(None),
    tipo_alerta: Optional[str] = Query(None),
    ambiente: List[str] = Query(default=[]),
    db: Session = Depends(get_db),
):
    tem_alerta_bool = None
    if tem_alerta == 'SIM':   tem_alerta_bool = True
    elif tem_alerta == 'NAO': tem_alerta_bool = False
    horarios_list: Optional[List[str]] = None
    if horarios_carga:
        horarios_list = [h.strip() for h in horarios_carga.split(',') if h.strip()]

    resultado = get_processos(
        db, skip=0, limit=5000,
        tabela=tabela, job=job, rotina=rotina, grupo_prefix=grupo,
        periodicidade=periodicidade, tasktype=tasktype, confirm=confirm, memlib=memlib,
        carga=carga, horarios_carga=horarios_list,
        isd=isd, evento_isd=evento_isd,
        tem_alerta=tem_alerta_bool, padrao=padrao, tipo_alerta=tipo_alerta,
        ambientes=ambiente or None,
    )
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=';')
    writer.writerow(['Tabela', 'Job', 'Grupo', 'Tasktype', 'Periodicidade', 'Carga', 'ISD', 'Tem Alerta', 'Tipo Alerta', 'Ambiente'])
    for p in resultado['processos']:
        writer.writerow([
            p.tabela, p.job, p.grupo,
            p.tasktype or '', p.periodicidade or '', p.carga or '',
            p.isd or '', 'SIM' if p.tem_alerta else 'NAO',
            p.tipo_alerta or '', p.ambiente or '',
        ])
    content = b'\xef\xbb\xbf' + buf.getvalue().encode('utf-8')
    return StreamingResponse(
        iter([content]),
        media_type='text/csv; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename="processos.csv"'},
    )


@router.get("/")
async def listar_processos(
    tabela: Optional[str] = Query(None),
    job: Optional[str] = Query(None),
    rotina: Optional[str] = Query(None),
    grupo: Optional[str] = Query(None),
    periodicidade: Optional[str] = Query(None),
    tasktype: Optional[str] = Query(None),
    confirm: Optional[str] = Query(None),
    memlib: Optional[str] = Query(None),
    carga: Optional[str] = Query(None),
    horarios_carga: Optional[str] = Query(None),
    isd: Optional[str] = Query(None),
    evento_isd: Optional[str] = Query(None),
    tem_alerta: Optional[str] = Query(None),
    padrao: Optional[str] = Query(None),
    tipo_alerta: Optional[str] = Query(None),
    ambiente: List[str] = Query(default=[]),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    skip = (page - 1) * limit

    tem_alerta_bool = None
    if tem_alerta == 'SIM':
        tem_alerta_bool = True
    elif tem_alerta == 'NAO':
        tem_alerta_bool = False

    horarios_list: Optional[List[str]] = None
    if horarios_carga:
        horarios_list = [h.strip() for h in horarios_carga.split(',') if h.strip()]

    resultado = get_processos(
        db, skip=skip, limit=limit,
        tabela=tabela, job=job, rotina=rotina, grupo_prefix=grupo,
        periodicidade=periodicidade, tasktype=tasktype, confirm=confirm, memlib=memlib,
        carga=carga, horarios_carga=horarios_list,
        isd=isd, evento_isd=evento_isd,
        tem_alerta=tem_alerta_bool, padrao=padrao, tipo_alerta=tipo_alerta,
        ambientes=ambiente or None,
    )

    return {
        "processos": [
            {
                "tabela": p.tabela,
                "job": p.job,
                "grupo": p.grupo,
                "tasktype": p.tasktype,
                "periodicidade": p.periodicidade,
                "carga": p.carga,
                "horario_carga": p.horario_carga,
                "isd": p.isd,
                "evento_isd": p.evento_isd,
                "tem_alerta": p.tem_alerta,
                "alerta_config": p.alerta_config,
                "tipo_alerta": p.tipo_alerta,
                "padrao": p.padrao,
                "confirm": p.confirm,
                "memlib": p.memlib,
                "resource": p.resource,
                "fromtime": p.fromtime,
                "untiltime": p.untiltime,
                "ambiente": p.ambiente,
            }
            for p in resultado["processos"]
        ],
        "total": resultado["total"],
        "resumo": resultado["resumo"],
        "page": page,
        "limit": limit,
    }


@router.get("/stats")
async def obter_stats_dashboard(db: Session = Depends(get_db)):
    return get_stats_dashboard(db)


@router.get("/{tabela}/{job}/{grupo}/stats")
async def obter_stats_processo(
    tabela: str, job: str, grupo: str,
    db: Session = Depends(get_db),
):
    stats = get_stats_processo(db, tabela=tabela, job=job, grupo=grupo)
    if not stats:
        return {"error": "Processo não encontrado"}
    return {
        "processo": f"{tabela}.{job}",
        "grupo": grupo,
        "execucoes_totais": stats.total_execucoes,
        "execucoes_sucesso": stats.execucoes_sucesso,
        "execucoes_falha": stats.execucoes_falha,
        "taxa_sucesso": stats.taxa_sucesso,
        "duracao_media_minutos": stats.duracao_media,
        "ultima_execucao": stats.ultima_execucao,
    }
