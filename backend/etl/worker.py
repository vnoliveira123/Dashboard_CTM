"""
ETL worker autônomo — executa o pipeline ETL em schedule separado da API.
Iniciar com:  python -m etl.worker
"""
import sys
import os
import time
import logging

# Garante que o diretório raiz do backend está no path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from etl.scheduler import executar_etl, iniciar_scheduler_etl

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [ETL-worker] %(levelname)s %(message)s',
)
logger = logging.getLogger(__name__)

if __name__ == '__main__':
    logger.info('ETL worker iniciado')
    scheduler = iniciar_scheduler_etl()
    try:
        while True:
            time.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        logger.info('Encerrando ETL worker...')
        scheduler.shutdown()
