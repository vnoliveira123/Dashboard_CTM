"""
Gerador de LOG sintético — escala de desenvolvimento (10%)
  Período  : 16/05/2026 a 15/06/2026  (30 dias — dentro da janela padrão do dashboard)
  Jobs      : lidos de CTM.csv  (~6.850 jobs)
  Volume    : até 100.000 linhas (cap)
  Estimativa: 6.850 jobs × ~7 dias × E[n_exec=2,34] ≈ 111.000 linhas

Grava em modo streaming → uso de RAM < 10 MB.
Tempo estimado: < 5 s.
"""
import csv
import random
import time
from datetime import datetime, timedelta
from pathlib import Path

random.seed(99)

CTM_PATH = Path(__file__).parent / 'csv_input' / 'CTM.csv'
LOG_PATH  = Path(__file__).parent / 'csv_input' / 'LOG.csv'

# Período: 16/05/2026 a 15/06/2026  (últimos 30 dias — dentro da janela padrão do dashboard)
START_DATE = datetime(2026, 5, 16)
END_DATE   = datetime(2026, 6, 15)
TOTAL_DAYS = (END_DATE - START_DATE).days + 1   # 31

MAX_ROWS = 100_000

FIELDNAMES = [
    'TABELA', 'JOB', 'GRUPO',
    'INICIO', 'FIM', 'STATUS',
    'HORA_PROC', 'MINUTOS_PROC', 'EXECUCOES', 'AMBIENTE',
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def fmt(dt: datetime) -> str:
    return dt.strftime('%H:%M - %d/%m/%y')

def hora_proc(delta: timedelta) -> str:
    tot = int(delta.total_seconds())
    return f'{tot // 3600:02d}:{(tot % 3600) // 60:02d}'

def minutos_proc(delta: timedelta) -> str:
    tot = int(delta.total_seconds())
    return f'{tot // 60:02d}:{tot % 60:02d}'

def parse_horario(row: dict) -> tuple[int, int]:
    ft = row.get('FROMTIME', '')
    if ft:
        try:
            h, m = ft.split(':')
            return int(h), int(m)
        except Exception:
            pass
    try:
        return int(str(row.get('HORARIO_CARGA', '07')).strip()), 0
    except Exception:
        return 7, 0


# Pesos de n_exec → E[n] = 0.26×1 + 0.30×2 + 0.28×3 + 0.16×4 = 2.34
_N_EXEC_POPULATION = [1, 2, 3, 4]
_N_EXEC_WEIGHTS    = [26, 30, 28, 16]

# Pesos de duração: concentrado entre 3–15 min, cauda até 90 min
_DUR_POPULATION = list(range(1, 91))
_DUR_WEIGHTS    = [max(1, 25 - abs(i - 6)) for i in range(1, 91)]


def gerar_execucoes(row: dict, data_base: datetime) -> list[dict]:
    tabela   = row['TABELA']
    job      = row['JOB']
    grupo    = row['GRUPO']
    ambiente = row.get('AMBIENTE', '')
    base_h, base_m = parse_horario(row)

    jitter  = timedelta(minutes=random.randint(-20, 20))
    inicio  = data_base.replace(hour=base_h, minute=base_m, second=0) + jitter

    dur_min = random.choices(_DUR_POPULATION, weights=_DUR_WEIGHTS)[0]
    dur_sec = random.randint(0, 59)
    n_exec  = random.choices(_N_EXEC_POPULATION, weights=_N_EXEC_WEIGHTS)[0]

    registros   = []
    cur_inicio  = inicio
    for run in range(n_exec):
        delta = timedelta(
            minutes=dur_min + random.randint(-1, 3),
            seconds=dur_sec,
        )
        if delta.total_seconds() < 60:
            delta = timedelta(minutes=1)
        cur_fim = cur_inicio + delta
        status  = 'OK' if random.random() < (0.88 if run == 0 else 0.92) else 'NOT OK'

        registros.append({
            'TABELA':       tabela,
            'JOB':          job,
            'GRUPO':        grupo,
            'INICIO':       fmt(cur_inicio),
            'FIM':          fmt(cur_fim),
            'STATUS':       status,
            'HORA_PROC':    hora_proc(delta),
            'MINUTOS_PROC': minutos_proc(delta),
            'EXECUCOES':    n_exec,
            'AMBIENTE':     ambiente,
        })
        cur_inicio = cur_fim + timedelta(minutes=random.randint(10, 40))

    return registros


# ── Main ──────────────────────────────────────────────────────────────────────

with open(CTM_PATH, encoding='utf-8', newline='') as f:
    jobs = list(csv.DictReader(f, delimiter='|'))

n_jobs = len(jobs)
print(f'CTM carregado: {n_jobs:,} jobs')
print(f'Periodo      : {START_DATE:%d/%m/%Y} - {END_DATE:%d/%m/%Y}  ({TOTAL_DAYS} dias)')
print(f'Volume alvo  : até {MAX_ROWS:,} linhas  (E[n_exec]=2,34 × {n_jobs:,} × {TOTAL_DAYS} dias)')
print(f'Arquivo saída: {LOG_PATH}')
print()

total_written = 0
t0 = time.time()

with open(LOG_PATH, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=FIELDNAMES, delimiter='|')
    writer.writeheader()

    cur_date = START_DATE
    day_num  = 0

    while cur_date <= END_DATE:
        day_num += 1
        done = False

        for job in jobs:
            records = gerar_execucoes(job, cur_date)
            # Respeita o cap de MAX_ROWS
            remaining = MAX_ROWS - total_written
            if remaining <= 0:
                done = True
                break
            if len(records) > remaining:
                records = records[:remaining]
            writer.writerows(records)
            total_written += len(records)
            if total_written >= MAX_ROWS:
                done = True
                break

        # Progresso a cada 5 dias ou no último dia
        if day_num % 5 == 0 or cur_date == END_DATE or done:
            elapsed = time.time() - t0
            pct     = total_written / MAX_ROWS
            mb_written = total_written * 100 / 1_048_576
            print(
                f'[{pct*100:5.1f}%]  {cur_date:%d/%m/%Y}'
                f'  |  {total_written:>10,} / {MAX_ROWS:,} linhas'
                f'  |  ~{mb_written:,.0f} MB'
            )

        if done:
            break

        cur_date += timedelta(days=1)

elapsed_total = time.time() - t0
ok_rate_approx = 88.0  # percentual aproximado

print()
print('=' * 54)
print(f'Concluído em {elapsed_total:.1f} s')
print(f'Total de linhas : {total_written:,}')
print(f'Taxa OK estimada: ~{ok_rate_approx:.0f}%')
print(f'Arquivo         : {LOG_PATH}')
print(f'Tamanho estimado: ~{total_written * 100 / 1_048_576:.0f} MB')
