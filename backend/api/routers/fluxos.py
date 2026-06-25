from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.orm import Session
from api.db.database import get_db
from api.db.queries import get_fluxos_grafo, get_rotinas_processos
from api.middleware.cache import get_or_cache
from typing import Optional, List

router = APIRouter()

_MAX_NODES = 500


@router.get("/rotinas")
async def listar_rotinas_processos(db: Session = Depends(get_db)):
    """Retorna prefixos de 4 letras distintos das tabelas de processos."""
    return get_or_cache(
        "cache:fluxos:rotinas", 3600,
        lambda: {"rotinas": get_rotinas_processos(db)},
    )


@router.get("/grafo")
async def obter_grafo_fluxos(
    grupo:         List[str] = Query(default=[]),
    tabela:        List[str] = Query(default=[]),
    job:           List[str] = Query(default=[]),
    rotina:        List[str] = Query(default=[]),
    ambiente:      List[str] = Query(default=[]),
    posicao:       Optional[str] = Query(None),
    carga:         Optional[str] = Query(None),
    horario_carga: Optional[str] = Query(None),
    controle:      Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Retorna nós e arestas para o grafo de fluxo, com filtros."""
    cache_key = (
        f"cache:fluxos:grafo:{','.join(sorted(grupo))}:{','.join(sorted(tabela))}"
        f":{','.join(sorted(job))}:{','.join(sorted(rotina))}"
        f":{','.join(sorted(ambiente))}:{posicao}:{carga}:{horario_carga}:{controle}"
    )
    try:
        return get_or_cache(
            cache_key, 300,
            lambda: get_fluxos_grafo(
                db,
                grupos=grupo, tabelas=tabela, jobs=job,
                rotinas=rotina, ambientes=ambiente or None,
                posicao=posicao, carga=carga,
                horario_carga=horario_carga, controle=controle,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
