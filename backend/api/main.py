from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routers import processos, execucoes, fluxos, analise
from api.db.database import init_db
import logging

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Log Dashboard API",
    description="API para análise de processos Control-M",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir routers
app.include_router(processos.router, prefix="/api/processos", tags=["Processos"])
app.include_router(execucoes.router, prefix="/api/execucoes", tags=["Execucoes"])
app.include_router(fluxos.router,  prefix="/api/fluxos",  tags=["Fluxos"])
app.include_router(analise.router, prefix="/api/analise", tags=["Analise"])

# ===== Startup Events =====
@app.on_event("startup")
async def startup_event():
    '''Inicializa banco de dados e scheduler na inicialização.'''
    logger.info("🚀 Iniciando aplicação...")
    
    # Inicializar banco de dados
    try:
        init_db()
    except Exception as e:
        logger.error(f"❌ Erro ao inicializar banco: {e}")

    logger.info("✅ Aplicação iniciada com sucesso!")

@app.get("/")
async def root():
    return {"message": "Log Dashboard API - v1.0.0", "status": "online"}

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": str(__import__('datetime').datetime.utcnow())}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
