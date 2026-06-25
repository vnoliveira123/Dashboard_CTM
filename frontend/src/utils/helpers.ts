export const calcularTaxaSucesso = (sucessos: number, total: number): number => {
  return total > 0 ? sucessos / total : 0;
};

export const agruparPorStatus = (execucoes: any[]): Record<string, number> => {
  return execucoes.reduce((acc, exec) => {
    acc[exec.status] = (acc[exec.status] || 0) + 1;
    return acc;
  }, {});
};
