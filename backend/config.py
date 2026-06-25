import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://log_dashboard:log_dashboard_password@localhost:5432/log_dashboard")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
ETL_SCHEDULE_HOUR = int(os.getenv("ETL_SCHEDULE_HOUR", "2"))
ETL_SCHEDULE_MINUTE = int(os.getenv("ETL_SCHEDULE_MINUTE", "5"))
CSV_INPUT_PATH = os.getenv("CSV_INPUT_PATH", "./csv_input")
