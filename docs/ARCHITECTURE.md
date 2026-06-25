# Arquitetura - Log Dashboard

## Overview
Sistema de análise de processos Control-M com volumetria massiva (50M+ logs).

## Stack
- **Backend:** FastAPI + Python + PostgreSQL + Redis
- **Frontend:** React + TypeScript + Material-UI + TailwindCSS + D3.js
- **ETL:** Python + Pandas + APScheduler
- **Infrastructure:** Docker + Docker Compose

## Fluxo de Dados
1. Mainframe exporta CTM.csv + LOG.csv para diretório público
2. ETL (02h05) lê arquivos, processa incrementalmente
3. PostgreSQL armazena dados + materialized views
4. FastAPI expõe endpoints paginados
5. React consome API, renderiza 3 telas

## Componentes Principais

### Backend
- **api/main.py** - FastAPI app
- **etl/** - Pipeline de ingestão
- **api/routers/** - Endpoints (processos, execucoes, fluxos)
- **api/db/** - Models + queries

### Frontend
- **Tela1_Processos.tsx** - Tabela de processos cadastrados
- **Tela2_Execucoes.tsx** - Timeline de execuções
- **Tela3_Fluxos.tsx** - Grafo de dependências

## Database Schema (PostgreSQL)
- raw_processos - Dados brutos CTM
- raw_execucoes - Logs de execução
- fluxos_processos - Grafo de dependências
- mat_processos_stats - Agregações
- mat_execucoes_timeline - Timeline

## Performance
- Queries <2s com índices otimizados
- Cache Redis para dados frequentes
- Paginação cursor-based para 50M linhas
