from fastapi import APIRouter, Query, Depends
from sqlalchemy.orm import Session
from api.db.database import get_db
from api.db.queries import (
    get_execucoes, get_execucoes_graficos, get_rotinas_disponiveis, get_sla_jobs,
    get_desvio_volumetria, get_tendencia_duracao, get_execucoes_multiplas_por_dia,
)
from api.middleware.cache import get_or_cache
from typing import Optional, List

router = APIRouter()


@router.get("/multiplas-por-dia")
async def obter_multiplas_por_dia(
    tabela:      List[str]  = Query(default=[]),
    job:         List[str]  = Query(default=[]),
    grupo:       List[str]  = Query(default=[]),
    rotina:      List[str]  = Query(default=[]),
    ambiente:    List[str]  = Query(default=[]),
    data_inicio: Optional[str] = Query(None),
    data_fim:    Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    tabelas = get_execucoes_multiplas_por_dia(
        db,
        tabelas=tabela or None, jobs=job or None, grupos=grupo or None, rotinas=rotina or None,
        data_inicio=data_inicio, data_fim=data_fim, ambientes=ambiente or None,
    )
    return {"tabelas": tabelas}


@router.get("/desvio-volumetria")
async def obter_desvio_volumetria(
    threshold:   float      = Query(50.0, ge=0, le=500),
    tabela:      List[str]  = Query(default=[]),
    job:         List[str]  = Query(default=[]),
    grupo:       List[str]  = Query(default=[]),
    rotina:      List[str]  = Query(default=[]),
    ambiente:    List[str]  = Query(default=[]),
    data_inicio: Optional[str] = Query(None),
    data_fim:    Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = get_desvio_volumetria(
        db, threshold_pct=threshold,
        tabelas=tabela or None, jobs=job or None, grupos=grupo or None, rotinas=rotina or None,
        data_inicio=data_inicio, data_fim=data_fim, ambientes=ambiente or None,
    )
    return {"alertas": rows, "threshold_pct": threshold}


@router.get("/tendencia-duracao")
async def obter_tendencia_duracao(
    tabela:      List[str]  = Query(default=[]),
    job:         List[str]  = Query(default=[]),
    grupo:       List[str]  = Query(default=[]),
    rotina:      List[str]  = Query(default=[]),
    ambiente:    List[str]  = Query(default=[]),
    data_inicio: Optional[str] = Query(None),
    data_fim:    Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = get_tendencia_duracao(
        db,
        tabelas=tabela or None, jobs=job or None, grupos=grupo or None, rotinas=rotina or None,
        data_inicio=data_inicio, data_fim=data_fim, ambientes=ambiente or None,
    )
    return {"alertas": rows}


@router.get("/rotinas")
async def listar_rotinas(db: Session = Depends(get_db)):
    return get_or_cache(
        "cache:execucoes:rotinas", 600,
        lambda: {"rotinas": get_rotinas_disponiveis(db)},
    )


@router.get("/sla")
async def obter_sla_jobs(
    sla_minutos: float     = Query(30.0, ge=0),
    tabela:      List[str] = Query(default=[]),
    job:         List[str] = Query(default=[]),
    grupo:       List[str] = Query(default=[]),
    rotina:      List[str] = Query(default=[]),
    ambiente:    List[str] = Query(default=[]),
    data_inicio: Optional[str] = Query(None),
    data_fim:    Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    jobs = get_sla_jobs(
        db, sla_minutos=sla_minutos,
        tabelas=tabela or None, jobs=job or None, grupos=grupo or None, rotinas=rotina or None,
        data_inicio=data_inicio, data_fim=data_fim, ambientes=ambiente or None,
    )
    return {"jobs": jobs, "sla_minutos": sla_minutos}


@router.get("/graficos")
async def obter_graficos(
    tabela: List[str] = Query(default=[]),
    job: List[str] = Query(default=[]),
    grupo: List[str] = Query(default=[]),
    rotina: List[str] = Query(default=[]),
    ambiente: List[str] = Query(default=[]),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    return get_execucoes_graficos(
        db,
        tabelas=tabela, jobs=job, grupos=grupo,
        rotinas=rotina, data_inicio=data_inicio, data_fim=data_fim,
        status=status, ambientes=ambiente or None,
    )


@router.get("/")
async def listar_execucoes(
    tabela: List[str] = Query(default=[]),
    job: List[str] = Query(default=[]),
    grupo: List[str] = Query(default=[]),
    rotina: List[str] = Query(default=[]),
    ambiente: List[str] = Query(default=[]),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    skip = (page - 1) * limit
    resultado = get_execucoes(
        db, skip=skip, limit=limit,
        tabelas=tabela, jobs=job, grupos=grupo,
        rotinas=rotina, data_inicio=data_inicio, data_fim=data_fim,
        status=status, ambientes=ambiente or None,
    )
    return {
        "execucoes": [
            {
                "tabela": e.tabela,
                "job": e.job,
                "grupo": e.grupo,
                "data_execucao": e.data_execucao.isoformat() if e.data_execucao else None,
                "status": e.status,
                "duracao_minutos": round(float(e.duracao_minutos), 2) if e.duracao_minutos else None,
                "ambiente": e.ambiente,
            }
            for e in resultado["execucoes"]
        ],
        "total": resultado["total"],
        "page": page,
        "limit": limit,
    }
