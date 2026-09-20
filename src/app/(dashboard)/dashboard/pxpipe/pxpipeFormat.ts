// Vive fora de `PxpipeTimelineChart` porque `PxpipeClient` também formata
// tokens: importá-lo de lá traria o recharts de volta para o chunk da rota,
// que é justamente o que o import dinâmico do gráfico evita.
export const fmtTokens = (n: number | undefined): string => {
  if (!n || n >= 1000000) return `${((n || 0) / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};
