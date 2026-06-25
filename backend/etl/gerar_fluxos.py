import re
import logging
from sqlalchemy.orm import Session
from api.db.models import Processo, Fluxo

logger = logging.getLogger(__name__)

# ── Regex para datecodes de condição ─────────────────────────────────────────
# Tokens conhecidos: JBSTAT (estático/controle), JBODAT, JBPREV, JOBNEXT, JB????
# JOBNEXT tem 7 chars; os demais JB???? têm 6 chars.
_DATE_PAT  = r'(?:JOBNEXT|JB[A-Z0-9*]{4})'
_OUT_RE    = re.compile(rf'(.+?{_DATE_PAT})\s*([+\-])', re.IGNORECASE | re.DOTALL)
_IN_RE     = re.compile(rf'.+?{_DATE_PAT}',            re.IGNORECASE | re.DOTALL)
_JBSTAT_RE = re.compile(r'JBSTAT', re.IGNORECASE)


def _is_jbstat(cond: str) -> bool:
    """Condição de semáforo estático — não é aresta de fluxo produtivo."""
    return bool(_JBSTAT_RE.search(cond))


def _parse_out_counds(raw: str) -> list[tuple[str, str]]:
    """
    Parseia OUT_COUNDS no formato concatenado sem separadores:
      COND1-JBODAT+COND2-JBSTAT-COND3-JBODAT+
    Retorna lista de (condicao, sinal).
    """
    if not raw:
        return []
    return _OUT_RE.findall(raw.strip())


def _parse_in_counds(raw: str) -> list[str]:
    """
    Parseia IN_COUNDS no mesmo formato concatenado (sem flags +/-).
    Retorna lista de strings de condição individuais.
    """
    if not raw:
        return []
    return [m.strip() for m in _IN_RE.findall(raw.strip()) if m.strip()]


def gerar_fluxos_automaticos(db: Session) -> int:
    """
    Gera fluxos a partir de OUT_COUNDS/IN_COUNDS dos processos CTM.
    Condições JBSTAT são semáforos de controle e são excluídas das arestas.
    """
    try:
        processos = db.query(Processo).all()
        logger.info(f'Analisando {len(processos)} processos para dependências...')

        # Índice: condição → processo que a consome (IN_COUNDS)
        indice_in: dict[str, Processo] = {}
        for p in processos:
            for cond in _parse_in_counds(p.in_counds or ''):
                indice_in.setdefault(cond, p)

        # Conjunto de fluxos já existentes para evitar duplicatas
        existentes = set(
            (f.job_origem, f.job_destino, f.condicao)
            for f in db.query(Fluxo.job_origem, Fluxo.job_destino, Fluxo.condicao).all()
        )

        novos_fluxos = []
        for origem in processos:
            if not origem.out_counds:
                continue
            for condicao, sinal in _parse_out_counds(origem.out_counds):
                if sinal != '+':
                    continue
                if _is_jbstat(condicao):
                    # Semáforo de controle — não cria aresta no grafo de fluxo
                    logger.debug(f'JBSTAT ignorado: {condicao} (origem: {origem.job})')
                    continue
                destino = indice_in.get(condicao.strip())
                if not destino:
                    continue
                chave = (origem.job, destino.job, condicao)
                if chave in existentes:
                    continue
                existentes.add(chave)
                novos_fluxos.append(Fluxo(
                    tabela_origem=origem.tabela,
                    job_origem=origem.job,
                    grupo_origem=origem.grupo,
                    tabela_destino=destino.tabela,
                    job_destino=destino.job,
                    condicao=condicao.strip(),
                    tipo_fluxo='CTM',
                    descricao=f'{origem.job} -> {destino.job} via {condicao.strip()}',
                ))

        if novos_fluxos:
            db.bulk_save_objects(novos_fluxos)
            db.commit()

        logger.info(f'Fluxos gerados: {len(novos_fluxos)}')
        return len(novos_fluxos)

    except Exception as e:
        logger.error(f'Erro ao gerar fluxos: {e}')
        db.rollback()
        return 0
