#!/bin/bash
# carga_csv.sh — dispara o pipeline ETL manualmente no container backend
# Uso:
#   ./scripts/carga_csv.sh              -> carga COMPLETA (trunca e recarrega tudo)
#   ./scripts/carga_csv.sh --incremental -> carga INCREMENTAL (somente novos registros de LOG)
#
# Execute sempre a partir da raiz do repositório.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSV_CTM="$ROOT/csv_input/CTM.csv"
CSV_LOG="$ROOT/csv_input/LOG.csv"
INCREMENTAL=false

for arg in "$@"; do
  [ "$arg" = "--incremental" ] && INCREMENTAL=true
done

echo ""
echo "====================================================="
echo "  Dashboard CTM — Carga de CSV"
echo "====================================================="

# ── 1. Verificar arquivos CSV ─────────────────────────────────────────────────
MISSING=0
[ ! -f "$CSV_CTM" ] && echo "[ERRO] Arquivo não encontrado: $CSV_CTM" && MISSING=1
[ ! -f "$CSV_LOG" ]  && echo "[ERRO] Arquivo não encontrado: $CSV_LOG"  && MISSING=1
if [ $MISSING -eq 1 ]; then
  echo "Coloque CTM.csv e LOG.csv em $ROOT/csv_input/ e tente novamente."
  exit 1
fi

echo ""
echo "  CTM.csv  : $(du -sh "$CSV_CTM" | cut -f1)"
echo "  LOG.csv  : $(du -sh "$CSV_LOG"  | cut -f1)"

# ── 2. Verificar se o container backend está rodando ─────────────────────────
CONTAINER=$(docker ps --filter "name=dashboard_ctm-backend" --format "{{.Names}}" | head -1)
if [ -z "$CONTAINER" ]; then
  echo ""
  echo "[ERRO] Nenhum container 'backend' em execução."
  echo "Execute 'docker-compose up -d' na raiz do repositório primeiro."
  exit 1
fi
echo "  Container : $CONTAINER"

# ── 3. Montar comando Python ──────────────────────────────────────────────────
if [ "$INCREMENTAL" = true ]; then
  echo "  Modo      : INCREMENTAL (somente novos registros de LOG)"
  PY_CMD="
import sys, os, logging
sys.path.insert(0, '/app')
os.chdir('/app')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
from etl.ingestao_ctm import ingerir_ctm
from etl.ingestao_logs import ingerir_logs_incremental
from etl.gerar_fluxos import gerar_fluxos_automaticos
from etl.transformacoes import agregar_processos, agregar_execucoes_timeline
from api.db.database import SessionLocal
db = SessionLocal()
n_ctm = ingerir_ctm('/app/csv_input/CTM.csv', db)
n_log = ingerir_logs_incremental('/app/csv_input/LOG.csv', db, incremental=True)
n_fluxos = gerar_fluxos_automaticos(db)
n_stats = agregar_processos(db)
n_tl = agregar_execucoes_timeline(db)
db.close()
print(f'CTM={n_ctm} LOG={n_log} FLUXOS={n_fluxos} STATS={n_stats} TIMELINE={n_tl}')
"
else
  echo "  Modo      : COMPLETO (trunca e recarrega tudo)"
  PY_CMD="
import sys, os, logging
sys.path.insert(0, '/app')
os.chdir('/app')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
from etl.scheduler import executar_etl
executar_etl()
"
fi

# ── 4. Executar no container ──────────────────────────────────────────────────
echo ""
echo "Iniciando ETL... (isso pode levar alguns minutos)"
echo "-----------------------------------------------------"
START=$(date +%s)

docker-compose -f "$ROOT/docker-compose.yml" exec -T backend python -c "$PY_CMD"

END=$(date +%s)
echo "-----------------------------------------------------"
echo ""
echo "ETL concluído em $((END - START))s"
echo ""
