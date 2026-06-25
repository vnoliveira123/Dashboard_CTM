import csv
import random
import itertools
import string

random.seed(42)

# ── Alvos ────────────────────────────────────────────────────────────────────
# 1.381 tabelas × jobs = 6.850 jobs  (10% da escala produtiva)
#   1.326 tabelas × 5 jobs = 6.630
#      55 tabelas × 4 jobs =   220
#                              ─────
#                              6.850 ✓
N_TABLES      = 1_381
N_5JOB_TABLES = 1_326
N_4JOB_TABLES =    55

# ── Listas de domínio ─────────────────────────────────────────────────────────
GRUPOS_PREFIX  = ['PR12', 'PR21', 'PR31', 'PR41']
HORARIOS       = ['00', '01', '03', '07', '10', '13', '16', '19', '23']
CALENDARIOS    = ['CAL_UTIL', 'CAL_MENSAL', 'CAL_ANUAL', 'CAL_SEMANAL', 'CAL_TODOS']
AMBIENTES      = ['AL1', 'MZ1']
TASKTYPES      = ['JOB', 'CYC']
EVENTOS_ISD    = ['FORCE TABELA', 'FORCE JOB', 'ADICIONA CONDIÇÃO']
ALERTA_CONFIGS = ['EXECTIME', 'LATE', 'LATESUB']
TIPOS_ALERTA   = ['OPER', 'TSO-P', 'U-ECS']
COMENTARIOS    = [
    'PROCESSAMENTO DIARIO DE LOTE',   'CARGA DE DADOS MENSAIS',
    'JOB DE RECONCILIACAO',           'PROCESSAMENTO FINANCEIRO',
    'GERACAO DE RELATORIOS',          'CARGA INCREMENTAL',
    'JOB DE BACKUP',                  'PROCESSAMENTO CONTABIL',
    'GERACAO DE EXTRATOS',            'CARGA DE TABELAS DE PARAMETRO',
    'PROCESSAMENTO DE PAGAMENTOS',    'RECONCILIACAO BANCARIA',
    'CARGA DE HISTORICO',             'JOB DE INTERFACE',
    'PROCESSAMENTO DE ARQUIVOS',
]

FIELDNAMES = [
    'TABELA', 'JOB', 'GRUPO', 'TASKTYPE', 'CARGA', 'HORARIO_CARGA',
    'ISD', 'EVENTO_ISD', 'TEM_ALERTA', 'ALERTA_CONFIG', 'TIPO_ALERTA',
    'PADRAO', 'MAXQAIT', 'FROMTIME', 'UNTILTIME', 'CONFIRM', 'MEMLIB',
    'RESOURCE', 'PERIODICIDADE', 'CALENDARIO', 'INTERSIT',
    'IN_COUNDS', 'OUT_COUNDS', 'COMENTARIO', 'AMBIENTE',
]


def memlib_resource(grupo):
    ml = random.choice(['MX.JCLFILE', f'MX.CTMR.{grupo}.SCHEFILE', 'DUMMY'])
    rs = (f'DM-{grupo}-INIT' if ml == 'DUMMY'
          else f'NC-{grupo}-INIT' if ml == 'MX.JCLFILE'
          else f'CR-{grupo}-INIT')
    return ml, rs


def random_time(hour_min=6, hour_max=23):
    h = random.randint(hour_min, hour_max)
    m = random.choice([0, 15, 30, 45])
    return f'{h:02d}:{m:02d}'


def make_condition(job_from, job_to):
    return f'{job_from}-{job_to}-JBODAT'


def generate_table(table_base, grupo, num_jobs, ambiente='AL1'):
    jobs      = [f'{table_base}{i:03d}' for i in range(num_jobs)]
    tabela    = jobs[0]
    tasktype  = random.choice(TASKTYPES)
    carga     = random.choice(['SIM', 'NAO'])
    horario   = random.choice(HORARIOS)
    isd       = random.choice(['SIM', 'NAO'])
    fromtime  = random_time(6, 20)
    from_h    = int(fromtime.split(':')[0])
    until_h   = min(from_h + random.randint(1, 4), 23)
    untiltime = f'{until_h:02d}:{random.choice([0,15,30,45]):02d}'
    ml, rs    = memlib_resource(grupo)

    rows = []
    for idx, job in enumerate(jobs):
        is_first = (idx == 0)
        is_last  = (idx == len(jobs) - 1)

        in_conds  = '' if is_first else make_condition(jobs[idx - 1], job)
        out_parts = []
        if not is_first:
            out_parts.append(make_condition(jobs[idx - 1], job) + ' -')
        if not is_last:
            out_parts.append(make_condition(job, jobs[idx + 1]) + ' +')

        tem_alerta    = random.choice(['SIM', 'NAO'])
        alerta_config = random.choice(ALERTA_CONFIGS) if tem_alerta == 'SIM' else ''
        tipo_alerta   = random.choice(TIPOS_ALERTA)   if tem_alerta == 'SIM' else ''
        intersit_val  = ''
        if random.random() < 0.3:
            ev = random.choice(EVENTOS_ISD)
            intersit_val = f'SIM; EVENTO: {ev}; {tabela}; AMBIENTE={random.choice(AMBIENTES)}'

        rows.append({
            'TABELA':        tabela,
            'JOB':           job,
            'GRUPO':         f'{grupo}-{tabela}',
            'TASKTYPE':      tasktype,
            'CARGA':         carga,
            'HORARIO_CARGA': horario,
            'ISD':           isd,
            'EVENTO_ISD':    random.choice(EVENTOS_ISD) if isd == 'SIM' else '',
            'TEM_ALERTA':    tem_alerta,
            'ALERTA_CONFIG': alerta_config,
            'TIPO_ALERTA':   tipo_alerta,
            'PADRAO':        random.choice(['SIM', 'NAO']),
            'MAXQAIT':       '05' if tasktype == 'JOB' else '00',
            'FROMTIME':      fromtime,
            'UNTILTIME':     untiltime,
            'CONFIRM':       'Y' if random.random() < 0.2 else '',
            'MEMLIB':        ml,
            'RESOURCE':      rs,
            'PERIODICIDADE': 'DIARIO',
            'CALENDARIO':    random.choice(CALENDARIOS),
            'INTERSIT':      intersit_val,
            'IN_COUNDS':     in_conds,
            'OUT_COUNDS':    '\n'.join(out_parts),
            'COMENTARIO':    random.choice(COMENTARIOS),
            'AMBIENTE':      ambiente,
        })
    return rows


# ── Gerar 27.614 bases únicas de 4 letras (ex: ABCD, WXYZ) ──────────────────
# 26^4 = 456.976 combinações disponíveis — mais que suficiente
all_combos = list(itertools.product(string.ascii_uppercase, repeat=4))
random.shuffle(all_combos)
TABLE_BASES = [''.join(c) for c in all_combos[:N_TABLES]]

# Primeiras N_5JOB_TABLES bases recebem 5 jobs; restantes recebem 4
job_counts = [5] * N_5JOB_TABLES + [4] * N_4JOB_TABLES

OUTPUT_PATH = r'C:\Users\victo\OneDrive\Documentos\Programação\Projetos\log_dashboard\csv_input\CTM.csv'

total_jobs   = 0
total_tables = 0

print(f'Gerando {N_TABLES:,} tabelas -> {N_5JOB_TABLES:,}x5 + {N_4JOB_TABLES:,}x4 = 6.850 jobs...')

with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=FIELDNAMES, delimiter='|')
    writer.writeheader()
    half = N_TABLES // 2
    for idx, (base, n_jobs) in enumerate(zip(TABLE_BASES, job_counts)):
        grupo    = random.choice(GRUPOS_PREFIX)
        ambiente = AMBIENTES[0] if idx < half else AMBIENTES[1]
        rows     = generate_table(base, grupo, n_jobs, ambiente)
        writer.writerows(rows)
        total_jobs   += len(rows)
        total_tables += 1
        if total_tables % 5_000 == 0:
            print(f'  {total_tables:>6,} tabelas / {total_jobs:>9,} jobs...')

print(f'\nConcluído:')
print(f'  Tabelas : {total_tables:,}')
print(f'  Jobs    : {total_jobs:,}')
print(f'  Arquivo : {OUTPUT_PATH}')
