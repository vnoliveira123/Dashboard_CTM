from fastapi import APIRouter, Query, Depends
from sqlalchemy.orm import Session
from datetime import date
from api.db.database import get_db
from api.db.queries import (
    get_historico_job_duracao,
    get_inicio_medio_jobs_batch,
    get_fluxos_downstream,
    get_caminho_entre_jobs,
    buscar_jobs,
)
from api.ml.predictor import DurationPredictor
import numpy as np

router = APIRouter()

CENARIO_PERCENTIL: dict[str, int] = {
    'normal':   50,
    'fds':      75,
    '5du':      90,
    'salario':  90,
    'mes_end':  90,
    'alto':     95,
}

MAX_DOWNSTREAM = 60


def _min_to_hhmm(m: float) -> str:
    m_int = int(round(m)) % 1440
    h, mn = divmod(m_int, 60)
    return f"{h:02d}:{mn:02d}"


@router.get("/caminho-critico")
async def caminho_critico(
    tab_origem:  str   = Query(...),
    job_origem:  str   = Query(...),
    tab_destino: str   = Query(...),
    job_destino: str   = Query(...),
    delay:       float = Query(..., ge=0, le=1440),
    data:        str   = Query(None),
    cenario:     str   = Query('normal'),
    db: Session = Depends(get_db),
):
    """Calcula o impacto de atraso de um job específico sobre um job objetivo,
    encontrando o caminho mais curto entre eles no grafo de fluxos."""
    percentil = CENARIO_PERCENTIL.get(cenario, 50)
    data_ref  = date.fromisoformat(data) if data else date.today()

    path = get_caminho_entre_jobs(db, tab_origem, job_origem, tab_destino, job_destino)

    if path is None:
        return {
            'encontrado': False,
            'caminho':    [],
            'n_hops':     0,
            'objetivo':   None,
            'mensagem':   (
                f'Nenhum caminho encontrado de {job_origem} para {job_destino}. '
                'Verifique se os jobs estão conectados no grafo de fluxos.'
            ),
        }

    start_times = get_inicio_medio_jobs_batch(db, path)

    resultado = []
    for job_key in path:
        t, j      = job_key
        hist      = get_historico_job_duracao(db, t, j)
        pred      = DurationPredictor().fit(hist)

        norm_start = start_times.get(job_key, 0.0)
        dur_p50    = pred.predict(data_ref, 50)
        dur_pred   = pred.predict(data_ref, percentil)

        p_start  = norm_start + delay
        p_end    = p_start + dur_pred
        norm_end = norm_start + dur_p50

        tem_dados = pred.n_samples > 0

        criticidade = 'ok'
        if delay > 60:
            criticidade = 'critico'
        elif delay > 30:
            criticidade = 'atencao'
        elif delay > 0:
            criticidade = 'leve'

        resultado.append({
            'tabela':              t,
            'job':                 j,
            'is_origem':           job_key == path[0],
            'is_destino':          job_key == path[-1],
            'tem_dados':           tem_dados,
            'expected_start_min':  round(norm_start, 1),
            'expected_end_min':    round(norm_end,   1),
            'expected_start':      _min_to_hhmm(norm_start) if tem_dados else '--:--',
            'expected_end':        _min_to_hhmm(norm_end)   if tem_dados else '--:--',
            'predicted_start_min': round(p_start, 1),
            'predicted_end_min':   round(p_end,   1),
            'predicted_start':     _min_to_hhmm(p_start) if tem_dados else '--:--',
            'predicted_end':       _min_to_hhmm(p_end)   if tem_dados else '--:--',
            'delay_propagado':     round(delay),
            'duracao_esperada':    round(dur_p50, 1),
            'duracao_prevista':    round(dur_pred, 1),
            'criticidade':         criticidade,
            'n_amostras':          pred.n_samples,
            'metodo':              pred.method,
        })

    return {
        'encontrado':    True,
        'caminho':       resultado,
        'n_hops':        len(path) - 1,
        'objetivo':      resultado[-1] if resultado else None,
        'delay_inicial': delay,
        'percentil':     percentil,
        'data_ref':      str(data_ref),
    }


@router.get("/cenarios")
async def listar_cenarios():
    return {
        'cenarios': [
            {'id': 'normal',  'label': 'Normal',               'descricao': 'Dia típico (P50)',            'percentil': 50},
            {'id': 'fds',     'label': 'Final de Semana',      'descricao': 'Acúmulo de remessa (P75)',    'percentil': 75},
            {'id': '5du',     'label': '5º Dia Útil',          'descricao': 'Processamento intenso (P90)', 'percentil': 90},
            {'id': 'salario', 'label': 'Pagamento de Salário', 'descricao': 'Alta demanda (P90)',          'percentil': 90},
            {'id': 'mes_end', 'label': 'Fechamento Mensal',    'descricao': 'Pico do ciclo (P90)',         'percentil': 90},
            {'id': 'alto',    'label': 'Alto Volume',          'descricao': 'Cenário extremo (P95)',       'percentil': 95},
        ]
    }


@router.get("/buscar-jobs")
async def endpoint_buscar_jobs(
    q: str = Query("", min_length=0),
    db: Session = Depends(get_db),
):
    return {'jobs': buscar_jobs(db, q)}


@router.get("/historico/{tabela}/{job}")
async def historico_job(tabela: str, job: str, db: Session = Depends(get_db)):
    dados = get_historico_job_duracao(db, tabela, job)
    if not dados:
        return {'dados': [], 'estatisticas': {}, 'n': 0}

    durs = [d['duracao'] for d in dados if d['duracao'] > 0]
    if not durs:
        return {'dados': dados, 'estatisticas': {}, 'n': 0}

    arr = np.array(durs)
    estatisticas = {
        'n':     int(len(arr)),
        'p25':   round(float(np.percentile(arr, 25)), 2),
        'p50':   round(float(np.percentile(arr, 50)), 2),
        'p75':   round(float(np.percentile(arr, 75)), 2),
        'p90':   round(float(np.percentile(arr, 90)), 2),
        'media': round(float(arr.mean()), 2),
        'max':   round(float(arr.max()), 2),
    }
    return {'dados': dados, 'estatisticas': estatisticas, 'n': len(arr)}


@router.get("/simulacao")
async def simular(
    tabela:  str   = Query(...),
    job:     str   = Query(...),
    delay:   float = Query(..., ge=0, le=1440),
    data:    str   = Query(None),
    cenario: str   = Query('normal'),
    db: Session = Depends(get_db),
):
    percentil = CENARIO_PERCENTIL.get(cenario, 50)
    data_ref  = date.fromisoformat(data) if data else date.today()

    # 1. BFS downstream (limited)
    subgraph, all_jobs = get_fluxos_downstream(db, tabela, job)

    if len(all_jobs) > MAX_DOWNSTREAM:
        limited: set = set()
        queue = [(tabela, job)]
        limited.add((tabela, job))
        while queue and len(limited) < MAX_DOWNSTREAM:
            cur = queue.pop(0)
            for dest in subgraph.get(cur, []):
                if dest not in limited:
                    limited.add(dest)
                    queue.append(dest)
        all_jobs = limited

    all_jobs_list = list(all_jobs)

    # 2. Train predictor per job
    predictors: dict = {}
    for key in all_jobs_list:
        hist = get_historico_job_duracao(db, key[0], key[1])
        predictors[key] = DurationPredictor().fit(hist)

    # 3. Average start times (batch)
    start_times = get_inicio_medio_jobs_batch(db, all_jobs_list)

    # 4. Build predecessors map (within the subgraph)
    preds_map: dict = {j: [] for j in all_jobs_list}
    for src in all_jobs_list:
        for dest in subgraph.get(src, []):
            if dest in all_jobs and dest in preds_map:
                preds_map[dest].append(src)

    # 5. Topological sort (Kahn's algorithm)
    in_deg = {j: len(preds_map.get(j, [])) for j in all_jobs_list}
    q_topo = [j for j in all_jobs_list if in_deg[j] == 0]
    topo: list = []
    while q_topo:
        cur = q_topo.pop(0)
        topo.append(cur)
        for dest in subgraph.get(cur, []):
            if dest in in_deg:
                in_deg[dest] -= 1
                if in_deg[dest] == 0:
                    q_topo.append(dest)
    # Append any nodes not reached (cycles)
    topo.extend([j for j in all_jobs_list if j not in topo])

    # 6. Cascade propagation
    start_key = (tabela, job)
    delay_map: dict = {}

    for j in topo:
        if j == start_key:
            delay_map[j] = float(delay)
        else:
            upstream = [delay_map.get(p, 0.0) for p in preds_map.get(j, [])]
            delay_map[j] = max(upstream) if upstream else 0.0

    # 7. Build result rows
    result = []
    for j in topo:
        t, jname = j
        norm_start  = start_times.get(j, 0.0)
        dur_p50     = predictors[j].predict(data_ref, 50)
        dur_pred    = predictors[j].predict(data_ref, percentil)
        d           = delay_map.get(j, 0.0)

        p_start = norm_start + d
        p_end   = p_start + dur_pred
        norm_end = norm_start + dur_p50

        if d > 60:
            criticidade = 'critico'
        elif d > 30:
            criticidade = 'atencao'
        elif d > 0:
            criticidade = 'leve'
        else:
            criticidade = 'ok'

        result.append({
            'tabela':              t,
            'job':                 jname,
            'expected_start_min':  round(norm_start, 1),
            'expected_end_min':    round(norm_end,   1),
            'expected_start':      _min_to_hhmm(norm_start),
            'expected_end':        _min_to_hhmm(norm_end),
            'predicted_start_min': round(p_start, 1),
            'predicted_end_min':   round(p_end,   1),
            'predicted_start':     _min_to_hhmm(p_start),
            'predicted_end':       _min_to_hhmm(p_end),
            'delay_propagado':     round(d),
            'duracao_esperada':    round(dur_p50, 1),
            'duracao_prevista':    round(dur_pred, 1),
            'criticidade':         criticidade,
            'n_amostras':          predictors[j].n_samples,
            'metodo':              predictors[j].method,
        })

    result.sort(key=lambda x: x['expected_start_min'])

    return {
        'simulacao':    result,
        'cenario':      cenario,
        'percentil':    percentil,
        'data_ref':     str(data_ref),
        'delay_inicial': delay,
        'total_jobs':   len(result),
    }
