export const formatarData = (data: Date | string): string => {
  if (!data) return '-';
  const d = new Date(data);
  return d.toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatarDuracao = (minutos: number): string => {
  if (!minutos) return '0m';
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;
  if (horas > 0) return \\h \m\;
  return \\m\;
};

export const formatarPercentual = (valor: number): string => {
  return \\%\;
};
