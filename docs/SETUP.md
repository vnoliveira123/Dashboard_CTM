# Setup - Log Dashboard

## Pré-requisitos
- Docker + Docker Compose
- Python 3.11+
- Node.js 18+

## Inicializar Projeto

### 1. Clonar/abrir repositório
\\\ash
cd log_dashboard
\\\

### 2. Configurar variáveis de ambiente
\\\ash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
\\\

### 3. Iniciar Docker
\\\ash
docker-compose up -d
\\\

### 4. Verificar services
\\\ash
docker-compose ps
\\\

## URLs
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## ETL
O ETL é executado automaticamente todos os dias às 02:05.
Logs em: \ackend/logs/etl.log\

## Troubleshooting
Se houver problemas, consulte ARCHITECTURE.md
