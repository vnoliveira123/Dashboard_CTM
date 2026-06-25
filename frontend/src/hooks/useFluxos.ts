import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface FiltrosFluxo {
  grupo?:         string[];
  tabela?:        string[];
  job?:           string[];
  rotina?:        string[];
  ambiente?:      string[];
  posicao?:       string;
  carga?:         string;
  horario_carga?: string;
  controle?:      string;
}

export interface GrafoNode {
  id:                   string;
  label:                string;
  grupo:                string;
  tabela:               string;
  posicao:              'inicio' | 'meio' | 'fim';
  carga:                string;
  horario_carga:        string;
  in_counds:            string;
  out_counds:           string;
  controle_efetuado:    boolean;
  suscetivel_controle:  boolean;
  condicoes_orfas:      string[];
  ultimo_status:        string | null;
}

export interface GrafoEdge {
  source:   string;
  target:   string;
  condicao: string;
}

export interface Grafo {
  nodes: GrafoNode[];
  edges: GrafoEdge[];
}

export const useFluxosGrafo = (filtros: FiltrosFluxo = {}, enabled = true) => {
  return useQuery({
    queryKey: ['fluxos-grafo', filtros],
    enabled,
    queryFn: async () => {
      const p = new URLSearchParams();
      (filtros.grupo    ?? []).forEach(v => p.append('grupo',    v));
      (filtros.tabela   ?? []).forEach(v => p.append('tabela',   v));
      (filtros.job      ?? []).forEach(v => p.append('job',      v));
      (filtros.rotina   ?? []).forEach(v => p.append('rotina',   v));
      (filtros.ambiente ?? []).forEach(v => p.append('ambiente', v));
      if (filtros.posicao)       p.append('posicao',       filtros.posicao);
      if (filtros.carga)         p.append('carga',         filtros.carga);
      if (filtros.horario_carga) p.append('horario_carga', filtros.horario_carga);
      if (filtros.controle)      p.append('controle',      filtros.controle);
      const { data } = await axios.get<Grafo>(`${API_URL}/api/fluxos/grafo?${p}`);
      return data;
    },
  });
};

export const useRotinasFluxos = () =>
  useQuery<{ rotinas: string[] }>({
    queryKey: ['fluxos-rotinas'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_URL}/api/fluxos/rotinas`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
