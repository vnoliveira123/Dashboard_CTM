export interface Processo {
  id?: number;
  tabela: string;
  job: string;
  grupo: string;
  periodicidade?: string;
  status?: string;
}

export interface Execucao {
  id?: number;
  tabela: string;
  job: string;
  grupo: string;
  inicio?: Date;
  fim?: Date;
  status: string;
  duracao?: number;
}

export interface Fluxo {
  id?: number;
  tabelaOrigem: string;
  jobOrigem: string;
  grupoOrigem: string;
  tabelaDestino: string;
  jobDestino: string;
  condicao?: string;
  tipoFluxo?: string;
}

export interface GrafoNode {
  id: string;
  label: string;
  grupo: string;
}

export interface GrafoEdge {
  source: string;
  target: string;
  condicao?: string;
}
