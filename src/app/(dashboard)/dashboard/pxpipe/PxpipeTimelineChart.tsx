"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fmtTokens } from "./pxpipeFormat";

export interface PxpipeTimelinePoint {
  date: string;
  tokensSavedEst: number;
}

// Vive num arquivo próprio para ser o único ponto de entrada do recharts nesta
// rota: `PxpipeClient` o carrega por `next/dynamic`, e na maioria das contas o
// pxpipe nem está instalado — o gráfico nunca chega a renderizar.
export default function PxpipeTimelineChart({ data }: { data: PxpipeTimelinePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradPxpipe" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtTokens} width={48} />
        <Tooltip formatter={(v) => [fmtTokens(Number(v)), "Tokens saved"]} labelFormatter={(d) => String(d)} />
        <Area type="monotone" dataKey="tokensSavedEst" stroke="#10b981" fill="url(#gradPxpipe)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
