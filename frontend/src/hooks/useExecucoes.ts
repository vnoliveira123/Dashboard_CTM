import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface FiltrosExecucao {
  tabela?: string[];
  job?: string[];
  grupo?: string[];
  rotina?: string[];
  ambiente?: string[];
  data_inicio?: string;
  data_fim?: string;
  status?: string;
}

export interface ExecucaoItem {
  tabela: string;
  job: string;
  grupo: string;
  data_execucao: string;
  status: string;
  duracao_minutos: number | null;
}

export interface ResumoAmbienteExecucao {
  total: number;
  ok: number;
  nok: number;
  duracao_media: number;
}

export interface ResumoExecucoes {
  total: number;
  ok: number;
  nok: number;
  duracao_media: number;
  job_maior_duracao: string;
  maior_duracao: number;
  por_ambiente?: Record<string, ResumoAmbienteExecucao>;
}

export interface VolumeData     { data: string; total: number; ok: number; nok: number; }
export interface TopDurData     { job: string; avg_dur: number; max_dur: number; }
export interface HoraData       { hora: number; total: number; ok: number; nok: number; }
export interface IsdData        { job: string; total: number; }
export interface TimeseriesItem { data: string; duracao: number; status: string; }

export interface GraficosData {
  resumo: ResumoExecucoes;
  volume_por_data: VolumeData[];
  top_duracao: TopDurData[];
  por_hora: HoraData[];
  isd_execucoes: IsdData[];
  timeseries: TimeseriesItem[];
}

export interface SlaItem {
  tabela:     string;
  job:        string;
  grupo:      string;
  avg_dur:    number;
  max_dur:    number;
  total_exec: number;
}

function buildParams(filtros: FiltrosExecucao, extra?: Record<string, string>) {
  const p = new URLSearchParams();
  (filtros.tabela   ?? []).forEach(v => p.append('tabela',   v));
  (filtros.job      ?? []).forEach(v => p.append('job',      v));
  (filtros.grupo    ?? []).forEach(v => p.append('grupo',    v));
  (filtros.rotina   ?? []).forEach(v => p.append('rotina',   v));
  (filtros.ambiente ?? []).forEach(v => p.append('ambiente', v));
  if (filtros.data_inicio) p.append('data_inicio', filtros.data_inicio);
  if (filtros.data_fim)    p.append('data_fim',    filtros.data_fim);
  if (filtros.status)      p.append('status',      filtros.status);
  if (extra) Object.entries(extra).forEach(([k, v]) => p.append(k, v));
  return p;
}

export const useExecucoes = (filtros: FiltrosExecucao = {}, page = 1) =>
  useQuery<{ execucoes: ExecucaoItem[]; total: number }>({
    queryKey: ['execucoes', filtros, page],
    queryFn: async () => {
      const p = buildParams(filtros, { page: String(page), limit: '20' });
      const { data } = await axios.get(`${API_URL}/api/execucoes?${p}`);
      return data;
    },
  });

export const useGraficosExecucoes = (filtros: FiltrosExecucao) =>
  useQuery<GraficosData>({
    queryKey: ['execucoes-graficos', filtros],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const p = buildParams(filtros);
      const { data } = await axios.get(`${API_URL}/api/execucoes/graficos?${p}`);
      return data;
    },
  });

export const useRotinasDisponiveis = () =>
  useQuery<{ rotinas: string[] }>({
    queryKey: ['execucoes-rotinas'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_URL}/api/execucoes/rotinas`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

export const useSlaJobs = (slaMinutos: number, filtros: FiltrosExecucao = {}) =>
  useQuery<{ jobs: SlaItem[]; sla_minutos: number }>({
    queryKey: ['execucoes-sla', slaMinutos, filtros],
    queryFn: async () => {
      const p = buildParams(filtros, { sla_minutos: String(slaMinutos) });
      const { data } = await axios.get(`${API_URL}/api/execucoes/sla?${p}`);
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });

export interface DesvioVolumetriaItem {
  tabela:     string;
  job:        string;
  grupo:      string;
  dia:        string;
  observado:  number;
  baseline:   number;
  desvio_pct: number;
}

export const useDesvioVolumetria = (threshold = 50, filtros: FiltrosExecucao = {}) =>
  useQuery<{ alertas: DesvioVolumetriaItem[]; threshold_pct: number }>({
    queryKey: ['execucoes-desvio-volumetria', threshold, filtros],
    queryFn: async () => {
      const p = buildParams(filtros, { threshold: String(threshold) });
      const { data } = await axios.get(`${API_URL}/api/execucoes/desvio-volumetria?${p}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

export interface TendenciaDuracaoItem {
  tabela:        string;
  job:           string;
  grupo:         string;
  dur_ultima:    number;
  dur_historico: number;
  variacao_pct:  number;
  semanas:       { semana: string; avg_dur: number; total: number }[];
}

export interface MultiplasItem {
  tabela:             string;
  grupo:              string;
  dias_com_multiplas: number;
  max_execucoes_dia:  number;
  total_execucoes:    number;
}

export const useMultiplasPorDia = (filtros: FiltrosExecucao = {}) =>
  useQuery<{ tabelas: MultiplasItem[] }>({
    queryKey: ['execucoes-multiplas-dia', filtros],
    queryFn: async () => {
      const p = buildParams(filtros);
      const { data } = await axios.get(`${API_URL}/api/execucoes/multiplas-por-dia?${p}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

export const useTendenciaDuracao = (filtros: FiltrosExecucao = {}) =>
  useQuery<{ alertas: TendenciaDuracaoItem[] }>({
    queryKey: ['execucoes-tendencia-duracao', filtros],
    queryFn: async () => {
      const p = buildParams(filtros);
      const { data } = await axios.get(`${API_URL}/api/execucoes/tendencia-duracao?${p}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
