# carga_csv.ps1 — dispara o pipeline ETL manualmente no container backend
# Uso:
#   .\scripts\carga_csv.ps1              -> carga COMPLETA (trunca e recarrega tudo)
#   .\scripts\carga_csv.ps1 -Incremental -> carga INCREMENTAL (somente novos registros de LOG)
#
# Execute sempre a partir da raiz do repositório.

param(
    [switch]$Incremental
)

$ROOT = Split-Path -Parent $PSScriptRoot
$CSV_CTM = Join-Path $ROOT "csv_input\CTM.csv"
$CSV_LOG  = Join-Path $ROOT "csv_input\LOG.csv"

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Dashboard CTM — Carga de CSV" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# ── 1. Verificar arquivos CSV ─────────────────────────────────────────────────
$missing = $false
if (-not (Test-Path $CSV_CTM)) {
    Write-Host "[ERRO] Arquivo nao encontrado: $CSV_CTM" -ForegroundColor Red
    $missing = $true
}
if (-not (Test-Path $CSV_LOG)) {
    Write-Host "[ERRO] Arquivo nao encontrado: $CSV_LOG" -ForegroundColor Red
    $missing = $true
}
if ($missing) {
    Write-Host "Coloque CTM.csv e LOG.csv em $ROOT\csv_input\ e tente novamente." -ForegroundColor Yellow
    exit 1
}

$sizeCTM = (Get-Item $CSV_CTM).Length / 1MB
$sizeLOG  = (Get-Item $CSV_LOG).Length  / 1MB
Write-Host ""
Write-Host "  CTM.csv  : $([math]::Round($sizeCTM, 1)) MB" -ForegroundColor Green
Write-Host "  LOG.csv  : $([math]::Round($sizeLOG, 1)) MB"  -ForegroundColor Green

# ── 2. Verificar se o container backend esta rodando ─────────────────────────
$containers = docker ps --filter "name=dashboard_ctm-backend" --format "{{.Names}}" 2>&1
if (-not $containers) {
    Write-Host ""
    Write-Host "[ERRO] Nenhum container 'backend' em execucao." -ForegroundColor Red
    Write-Host "Execute 'docker-compose up -d' na raiz do repositorio primeiro." -ForegroundColor Yellow
    exit 1
}
Write-Host ""
Write-Host "  Container : dashboard_ctm-backend-1" -ForegroundColor Green

# ── 3. Montar comando Python ──────────────────────────────────────────────────
if ($Incremental) {
    Write-Host "  Modo      : INCREMENTAL (somente novos registros de LOG)" -ForegroundColor Yellow
    $pyCmd = @"
import sys, os, logging
sys.path.insert(0, '/app')
os.chdir('/app')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
from etl.ingestao_ctm import ingerir_ctm
from etl.ingestao_logs import ingerir_logs_incremental
from etl.gerar_fluxos import gerar_fluxos_automaticos
from etl.transformacoes import agregar_processos, agregar_execucoes_timeline
from etl.scheduler import executar_etl
from api.db.database import SessionLocal
from pathlib import Path
db = SessionLocal()
n_ctm = ingerir_ctm('/app/csv_input/CTM.csv', db)
n_log = ingerir_logs_incremental('/app/csv_input/LOG.csv', db, incremental=True)
n_fluxos = gerar_fluxos_automaticos(db)
n_stats = agregar_processos(db)
n_tl = agregar_execucoes_timeline(db)
db.close()
print(f'CTM={n_ctm} LOG={n_log} FLUXOS={n_fluxos} STATS={n_stats} TIMELINE={n_tl}')
"@
} else {
    Write-Host "  Modo      : COMPLETO (trunca e recarrega tudo)" -ForegroundColor Cyan
    $pyCmd = @"
import sys, os, logging
sys.path.insert(0, '/app')
os.chdir('/app')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
from etl.scheduler import executar_etl
executar_etl()
"@
}

# ── 4. Executar no container ──────────────────────────────────────────────────
Write-Host ""
Write-Host "Iniciando ETL... (isso pode levar alguns minutos)" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------"
$start = Get-Date

docker-compose -f "$ROOT\docker-compose.yml" exec -T backend python -c $pyCmd

$elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
Write-Host "-----------------------------------------------------"
Write-Host ""
Write-Host "ETL concluido em ${elapsed}s" -ForegroundColor Green
Write-Host ""
