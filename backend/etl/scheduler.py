from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from config import ETL_SCHEDULE_HOUR, ETL_SCHEDULE_MINUTE, CSV_INPUT_PATH
from etl.ingestao_ctm import ingerir_ctm
from etl.ingestao_logs import ingerir_logs_incremental
from etl.gerar_fluxos import gerar_fluxos_automaticos
from etl.transformacoes import agregar_processos, agregar_execucoes_timeline
from api.db.database import SessionLocal
from api.middleware.cache import invalidar_padrao
import logging
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

def executar_etl():
    '''
    Executa o pipeline ETL completo:
    1. Ler CTM.csv → upsert raw_processos
    2. Ler LOG.csv → append incremental raw_execucoes
    3. Gerar fluxos automáticos
    4. Atualizar agregações
    '''
    logger.info('=' * 60)
    logger.info('🔄 INICIANDO ETL')
    logger.info('=' * 60)
    
    db = SessionLocal()
    
    try:
        # Construir caminhos
        csv_input_path = Path(CSV_INPUT_PATH)
        arquivo_ctm = csv_input_path / 'CTM.csv'
        arquivo_logs = csv_input_path / 'LOG.csv'
        
        # 1. Ingerir CTM
        if arquivo_ctm.exists():
            logger.info(f'📥 Ingerindo CTM: {arquivo_ctm}')
            count_ctm = ingerir_ctm(str(arquivo_ctm), db)
        else:
            logger.warning(f'⚠️ Arquivo não encontrado: {arquivo_ctm}')
            count_ctm = 0
        
        # 2. Ingerir LOGS
        if arquivo_logs.exists():
            logger.info(f'📥 Ingerindo LOGS: {arquivo_logs}')
            count_logs = ingerir_logs_incremental(str(arquivo_logs), db)
        else:
            logger.warning(f'⚠️ Arquivo não encontrado: {arquivo_logs}')
            count_logs = 0
        
        # 3. Gerar fluxos
        logger.info('🔗 Gerando fluxos automáticos...')
        count_fluxos = gerar_fluxos_automaticos(db)
        
        # 4. Atualizar agregações
        logger.info('📊 Atualizando agregações...')
        count_stats = agregar_processos(db)
        count_timeline = agregar_execucoes_timeline(db)
        
        logger.info('=' * 60)
        logger.info('✅ ETL CONCLUÍDO')
        logger.info(f'  CTM: {count_ctm} registros')
        logger.info(f'  LOGS: {count_logs} registros')
        logger.info(f'  FLUXOS: {count_fluxos} registros')
        logger.info(f'  STATS: {count_stats} registros')
        logger.info(f'  TIMELINE: {count_timeline} registros')
        logger.info('=' * 60)

        # Invalida todo o cache após ETL para garantir dados frescos na API
        invalidar_padrao('cache:*')
        logger.info('Cache Redis invalidado')

    except Exception as e:
        logger.error(f'❌ ERRO NO ETL: {e}')
        import traceback
        logger.error(traceback.format_exc())
    
    finally:
        db.close()

def iniciar_scheduler_etl():
    '''
    Inicia o scheduler para executar ETL diariamente.
    '''
    scheduler = BackgroundScheduler()
    
    # Agendar ETL para rodar diariamente
    trigger = CronTrigger(
        hour=ETL_SCHEDULE_HOUR,
        minute=ETL_SCHEDULE_MINUTE,
        timezone='America/Sao_Paulo'
    )
    
    scheduler.add_job(
        func=executar_etl,
        trigger=trigger,
        id='etl_diario',
        name='ETL Diário',
        replace_existing=True
    )
    
    scheduler.start()
    logger.info(f'✅ ETL agendado para {ETL_SCHEDULE_HOUR:02d}:{ETL_SCHEDULE_MINUTE:02d} (São Paulo)')
    return scheduler
