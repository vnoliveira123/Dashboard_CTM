from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ProcessoBase(BaseModel):
    tabela: str
    job: str
    grupo: str

class ProcessoResponse(ProcessoBase):
    id: Optional[int] = None

class ExecucaoBase(BaseModel):
    tabela: str
    job: str
    grupo: str
    status: str

class ExecucaoResponse(ExecucaoBase):
    id: Optional[int] = None
    inicio: Optional[datetime] = None
    fim: Optional[datetime] = None

class FluxoBase(BaseModel):
    tabela_origem: str
    job_origem: str
    tabela_destino: str
    job_destino: str

class FluxoResponse(FluxoBase):
    id: Optional[int] = None
