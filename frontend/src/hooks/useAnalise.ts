import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type Criticidade = 'ok' | 'leve' | 'atencao' | 'critico';

export interface SimulacaoItem {
  tabela:              string;
  job:                 string;
  expected_start_min:  number;
  expected_end_min:    number;
  expected_start:      string;
  expected_end:        string;
  predicted_start_min: number;
  predicted_end_min:   number;
  predicted_start:     string;
  predicted_end:       string;
  delay_propagado:     number;
  duracao_esperada:    number;
  duracao_prevista:    number;
  criticidade:         Criticidade;
  n_amostras:          number;
  metodo:              string;
}

export interface SimulacaoResponse {
  simulacao:    SimulacaoItem[];
  cenario:      string;
  percentil:    number;
  data_ref:     string;
  delay_inicial: number;
  total_jobs:   number;
}

export interface HistoricoEstatisticas {
  n:     number;
  p25:   number;
  p50:   number;
  p75:   number;
  p90:   number;
  media: number;
  max:   number;
}

export interface HistoricoDia {
  data:    string;
  duracao: number;
  total:   number;
  ok:      number;
  nok:     number;
}

export interface HistoricoResponse {
  dados:        HistoricoDia[];
  estatisticas: HistoricoEstatisticas;
  n:            number;
}

export interface CenarioItem {
  id:        string;
  label:     string;
  descricao: string;
  percentil: number;
}

export interface JobBusca {
  tabela: string;
  job:    string;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export interface SimulacaoParams {
  tabela:  string;
  job:     string;
  delay:   number;
  data:    string;
  cenario: string;
}

export const useSimulacao = (params: SimulacaoParams | null) =>
  useQuery<SimulacaoResponse>({
    queryKey: ['analise-simulacao', params],
    enabled:  params !== null,
    staleTime: 0,
    queryFn: async () => {
      if (!params) throw new Error('sem params');
      const p = new URLSearchParams({
        tabela:  params.tabela,
        job:     params.job,
        delay:   String(params.delay),
        data:    params.data,
        cenario: params.cenario,
      });
      const { data } = await axios.get<SimulacaoResponse>(
        `${API_URL}/api/analise/simulacao?${p}`,
      );
      return data;
    },
  });

export const useHistoricoJob = (tabela: string, job: string, enabled = true) =>
  useQuery<HistoricoResponse>({
    queryKey:  ['analise-historico', tabela, job],
    enabled:   enabled && !!tabela && !!job,
    staleTime: 5 * 60 * 1000,
    queryFn:   async () => {
      const { data } = await axios.get<HistoricoResponse>(
        `${API_URL}/api/analise/historico/${encodeURIComponent(tabela)}/${encodeURIComponent(job)}`,
      );
      return data;
    },
  });

export const useCenarios = () =>
  useQuery<{ cenarios: CenarioItem[] }>({
    queryKey:  ['analise-cenarios'],
    staleTime: Infinity,
    queryFn:   async () => {
      const { data } = await axios.get(`${API_URL}/api/analise/cenarios`);
      return data;
    },
  });

export interface CaminhoItem {
  tabela:              string;
  job:                 string;
  is_origem:           boolean;
  is_destino:          boolean;
  tem_dados:           boolean;
  expected_start_min:  number;
  expected_end_min:    number;
  expected_start:      string;
  expected_end:        string;
  predicted_start_min: number;
  predicted_end_min:   number;
  predicted_start:     string;
  predicted_end:       string;
  delay_propagado:     number;
  duracao_esperada:    number;
  duracao_prevista:    number;
  criticidade:         Criticidade;
  n_amostras:          number;
  metodo:              string;
}

export interface CaminhoCriticoResponse {
  encontrado:    boolean;
  caminho:       CaminhoItem[];
  n_hops:        number;
  objetivo:      CaminhoItem | null;
  delay_inicial: number;
  percentil:     number;
  data_ref:      string;
  mensagem?:     string;
}

export interface CaminhoCriticoParams {
  tab_origem:  string;
  job_origem:  string;
  tab_destino: string;
  job_destino: string;
  delay:       number;
  data:        string;
  cenario:     string;
}

export const useCaminhoCritico = (params: CaminhoCriticoParams | null) =>
  useQuery<CaminhoCriticoResponse>({
    queryKey:  ['analise-caminho', params],
    enabled:   params !== null,
    staleTime: 0,
    queryFn:   async () => {
      if (!params) throw new Error('sem params');
      const p = new URLSearchParams({
        tab_origem:  params.tab_origem,
        job_origem:  params.job_origem,
        tab_destino: params.tab_destino,
        job_destino: params.job_destino,
        delay:       String(params.delay),
        data:        params.data,
        cenario:     params.cenario,
      });
      const { data } = await axios.get<CaminhoCriticoResponse>(
        `${API_URL}/api/analise/caminho-critico?${p}`,
      );
      return data;
    },
  });

export const useBuscarJobs = (q: string) =>
  useQuery<{ jobs: JobBusca[] }>({
    queryKey:  ['analise-buscar-jobs', q],
    staleTime: 30 * 1000,
    queryFn:   async () => {
      const { data } = await axios.get(
        `${API_URL}/api/analise/buscar-jobs?q=${encodeURIComponent(q)}`,
      );
      return data;
    },
  });
