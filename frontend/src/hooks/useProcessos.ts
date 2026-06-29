import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface FiltrosProcesso {
  tabela?: string;
  job?: string;
  rotina?: string;
  grupo?: string;
  periodicidade?: string;
  tasktype?: string;
  confirm?: string;
  memlib?: string;
  carga?: string;
  horarios_carga?: string[];
  isd?: string;
  evento_isd?: string;
  tem_alerta?: string;
  padrao?: string;
  tipo_alerta?: string;
  ambiente?: string[];
}

export interface ProcessoItem {
  tabela: string;
  job: string;
  grupo: string;
  tasktype?: string;
  periodicidade?: string;
  carga?: string;
  horario_carga?: string;
  isd?: string;
  evento_isd?: string;
  tem_alerta?: boolean;
  alerta_config?: string;
  tipo_alerta?: string;
  padrao?: string;
  confirm?: string;
  memlib?: string;
  resource?: string;
  fromtime?: string;
  untiltime?: string;
}

export interface ResumoAmbienteProcesso {
  total_jobs:    number;
  total_tabelas: number;
  tabelas_carga: number;
  tabelas_isd:   number;
  tabelas_alerta: number;
  jobs_alerta:   number;
}

export interface ResumoProcessos {
  total_jobs:    number;
  total_tabelas: number;
  tabelas_carga: number;
  tabelas_isd:   number;
  tabelas_alerta: number;
  jobs_alerta:   number;
  por_ambiente?: Record<string, ResumoAmbienteProcesso>;
}

export interface GraficosProcessos {
  periodicidades:  { periodicidade: string; total: number }[];
  jobs_por_tabela: { tabela: string; total_jobs: number }[];
  carga:   { sim: number; nao: number; total: number };
  isd:     { sim: number; nao: number; total: number };
  alertas: { sim: number; nao: number; total: number };
}

export interface RespostaProcessos {
  processos: ProcessoItem[];
  total: number;
  resumo: ResumoProcessos;
  page: number;
  limit: number;
}

export const useProcessos = (filtros: FiltrosProcesso = {}, page: number = 1, enabled = true) => {
  return useQuery<RespostaProcessos>({
    queryKey: ['processos', filtros, page],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filtros.tabela) params.append('tabela', filtros.tabela);
      if (filtros.job) params.append('job', filtros.job);
      if (filtros.rotina) params.append('rotina', filtros.rotina);
      if (filtros.grupo) params.append('grupo', filtros.grupo);
      if (filtros.periodicidade) params.append('periodicidade', filtros.periodicidade);
      if (filtros.tasktype) params.append('tasktype', filtros.tasktype);
      if (filtros.confirm) params.append('confirm', filtros.confirm);
      if (filtros.memlib) params.append('memlib', filtros.memlib);
      if (filtros.carga) params.append('carga', filtros.carga);
      if (filtros.horarios_carga?.length) params.append('horarios_carga', filtros.horarios_carga.join(','));
      if (filtros.isd) params.append('isd', filtros.isd);
      if (filtros.evento_isd) params.append('evento_isd', filtros.evento_isd);
      if (filtros.tem_alerta) params.append('tem_alerta', filtros.tem_alerta);
      if (filtros.padrao) params.append('padrao', filtros.padrao);
      if (filtros.tipo_alerta) params.append('tipo_alerta', filtros.tipo_alerta);
      (filtros.ambiente ?? []).forEach(v => params.append('ambiente', v));
      params.append('page', page.toString());
      params.append('limit', '20');
      const { data } = await axios.get(`${API_URL}/api/processos?${params}`);
      return data;
    },
  });
};

export const useGraficosProcessos = (filtros: FiltrosProcesso = {}) =>
  useQuery<GraficosProcessos>({
    queryKey: ['processos-graficos', filtros],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filtros.tabela)        params.append('tabela',        filtros.tabela);
      if (filtros.job)           params.append('job',           filtros.job);
      if (filtros.rotina)        params.append('rotina',        filtros.rotina);
      if (filtros.grupo)         params.append('grupo',         filtros.grupo);
      if (filtros.periodicidade) params.append('periodicidade', filtros.periodicidade);
      if (filtros.tasktype)      params.append('tasktype',      filtros.tasktype);
      if (filtros.confirm)       params.append('confirm',       filtros.confirm);
      if (filtros.memlib)        params.append('memlib',        filtros.memlib);
      if (filtros.carga)         params.append('carga',         filtros.carga);
      if (filtros.isd)           params.append('isd',           filtros.isd);
      if (filtros.tem_alerta)    params.append('tem_alerta',    filtros.tem_alerta);
      (filtros.ambiente ?? []).forEach(v => params.append('ambiente', v));
      const { data } = await axios.get(`${API_URL}/api/processos/graficos?${params}`);
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });

export const useFiltrosDisponiveis = () => {
  return useQuery<{ periodicidades: string[]; tasktypes: string[]; rotinas: string[] }>({
    queryKey: ['processos-filtros'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_URL}/api/processos/filtros`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
};

export interface JobSemExecucao {
  tabela: string;
  job: string;
  grupo: string;
  periodicidade: string | null;
  carga: string | null;
}

export interface AlertaNaoPadrao {
  tabela: string;
  job: string;
  grupo: string;
  tipo_alerta: string;
  total_exec: number;
}

export const useJobsSemExecucao = (limit = 50, filtros: FiltrosProcesso = {}) =>
  useQuery<{ jobs: JobSemExecucao[]; total: number }>({
    queryKey: ['processos-sem-execucao', limit, filtros],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (filtros.tabela) p.append('tabela', filtros.tabela);
      if (filtros.job)    p.append('job',    filtros.job);
      if (filtros.grupo)  p.append('grupo',  filtros.grupo);
      if (filtros.rotina) p.append('rotina', filtros.rotina);
      if (filtros.carga)  p.append('carga',  filtros.carga);
      if (filtros.isd)    p.append('isd',    filtros.isd);
      (filtros.ambiente ?? []).forEach(v => p.append('ambiente', v));
      const { data } = await axios.get(`${API_URL}/api/processos/sem-execucao?${p}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

export interface AlertasFiltros {
  tabela?:      string;
  job?:         string;
  rotina?:      string;
  grupo?:       string;
  tipo_alerta?: string;
}

export const useAlertasNaoPadrao = (filtros: AlertasFiltros = {}) =>
  useQuery<{ alertas: AlertaNaoPadrao[] }>({
    queryKey: ['processos-alertas-nao-padrao', filtros],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (filtros.tabela)      p.append('tabela',      filtros.tabela);
      if (filtros.job)         p.append('job',         filtros.job);
      if (filtros.rotina)      p.append('rotina',      filtros.rotina);
      if (filtros.grupo)       p.append('grupo',       filtros.grupo);
      if (filtros.tipo_alerta) p.append('tipo_alerta', filtros.tipo_alerta);
      const { data } = await axios.get(
        `${API_URL}/api/processos/alertas-nao-padrao?${p}`,
      );
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

export interface JanelaCargaItem {
  tabela:          string;
  hora_programada: number;
  grupo:           string;
  dia:             string;
  primeiro_inicio: string;
  hora_real:       number;
  min_real:        number;
  delta_minutos:   number;
  status:          'no_prazo' | 'atrasada';
}

export interface JanelaCargaFiltros {
  dias?:           number;
  tabela?:         string;
  rotina?:         string;
  grupo?:          string;
  horarios_carga?: string[];
}

export const useJanelaCarga = (filtros: JanelaCargaFiltros = {}, enabled = true) =>
  useQuery<{ janela: JanelaCargaItem[] }>({
    queryKey: ['processos-janela-carga', filtros],
    enabled,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (filtros.dias)                      p.append('dias',           String(filtros.dias ?? 7));
      if (filtros.tabela)                    p.append('tabela',         filtros.tabela);
      if (filtros.rotina)                    p.append('rotina',         filtros.rotina);
      if (filtros.grupo)                     p.append('grupo',          filtros.grupo);
      if (filtros.horarios_carga?.length)    p.append('horarios_carga', filtros.horarios_carga.join(','));
      const { data } = await axios.get(
        `${API_URL}/api/processos/janela-carga?${p}`,
      );
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
