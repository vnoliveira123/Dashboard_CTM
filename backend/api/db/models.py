from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean, Text
from sqlalchemy.orm import declarative_base
from datetime import datetime

Base = declarative_base()

class Processo(Base):
    __tablename__ = 'raw_processos'
    
    id = Column(Integer, primary_key=True, index=True)
    tabela = Column(String(100), nullable=False)
    job = Column(String(100), nullable=False)
    grupo = Column(String(100), nullable=False)
    tasktype = Column(String(50))
    carga = Column(String(50))
    horario_carga = Column(String(20))
    isd = Column(String(50))
    evento_isd = Column(String(50))
    tem_alerta = Column(Boolean, default=False)
    alerta_config = Column(Text)
    tipo_alerta = Column(String(50))
    padrao = Column(String(50))
    maxqait = Column(Integer)
    fromtime = Column(String(20))
    untiltime = Column(String(20))
    confirm = Column(String(50))
    memlib = Column(String(50))
    resource = Column(String(50))
    periodicidade = Column(String(50))
    calendario = Column(String(50))
    intersit = Column(Text)
    in_counds = Column(Text)
    out_counds = Column(Text)
    comentario = Column(Text)
    ambiente = Column(String(10))
    data_insercao = Column(DateTime, default=datetime.utcnow)
    data_atualizacao = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Execucao(Base):
    __tablename__ = 'raw_execucoes'
    
    id = Column(Integer, primary_key=True, index=True)
    tabela = Column(String(100), nullable=False)
    job = Column(String(100), nullable=False)
    grupo = Column(String(100), nullable=False)
    inicio = Column(DateTime)
    fim = Column(DateTime)
    status = Column(String(50), nullable=False)
    hora_proc = Column(String(20))
    minutos_proc = Column(Float)
    execucoes = Column(Integer, default=1)
    ambiente = Column(String(10))
    data_insercao = Column(DateTime, default=datetime.utcnow)


class Fluxo(Base):
    __tablename__ = 'fluxos_processos'
    
    id = Column(Integer, primary_key=True, index=True)
    tabela_origem = Column(String(100), nullable=False)
    job_origem = Column(String(100), nullable=False)
    grupo_origem = Column(String(100), nullable=False)
    tabela_destino = Column(String(100), nullable=False)
    job_destino = Column(String(100), nullable=False)
    condicao = Column(String(100))
    tipo_fluxo = Column(String(50))
    descricao = Column(Text)
    data_insercao = Column(DateTime, default=datetime.utcnow)


class ProcessoStats(Base):
    __tablename__ = 'mat_processos_stats'
    
    id = Column(Integer, primary_key=True, index=True)
    tabela = Column(String(100), nullable=False)
    job = Column(String(100), nullable=False)
    grupo = Column(String(100), nullable=False)
    total_execucoes = Column(Integer, default=0)
    execucoes_sucesso = Column(Integer, default=0)
    execucoes_falha = Column(Integer, default=0)
    taxa_sucesso = Column(Float, default=0.0)
    duracao_media = Column(Float, default=0.0)
    ultima_execucao = Column(DateTime)
    data_atualizacao = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ExecucaoTimeline(Base):
    __tablename__ = 'mat_execucoes_timeline'

    # TimescaleDB exige que unique constraints incluam a coluna de partição.
    # Composite PK (id, data_execucao) satisfaz esse requisito.
    id            = Column(Integer, primary_key=True, autoincrement=True)
    tabela        = Column(String(100), nullable=False)
    job           = Column(String(100), nullable=False)
    grupo         = Column(String(100), nullable=False)
    data_execucao = Column(DateTime, nullable=False, primary_key=True)
    status        = Column(String(50), nullable=False)
    duracao_minutos  = Column(Float)
    ambiente         = Column(String(10))
    data_atualizacao = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
