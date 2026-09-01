"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Image as ImageIcon } from "lucide-react";

const fmtTokens = (n: number | undefined) => {
  if (!n || n >= 1000000) return `${((n || 0) / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtUptime = (ms: number | undefined) => {
  if (!ms || ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

const WINDOW_TABS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7d", label: "7 days" },
  { id: "last30d", label: "30 days" },
  { id: "all", label: "All time" },
];

const REASON_LABELS = {
  applied: "Prompt exceeded limit",
  below_threshold: "Below size threshold",
  not_profitable: "Compression not profitable",
  below_min_chars: "Below minimum characters",
  below_min_tokens: "Below minimum tokens",
  unsupported_model: "Model not in allowlist",
  unsupported_format: "Non-Claude request format",
  timeout: "Compression timeout",
  transform_error: "Transform error",
  passthrough: "Passthrough",
  disabled: "Disabled",
  not_installed: "Not installed",
};

interface PxpipeStatus {
  installed?: boolean;
  running?: boolean;
  enabled?: boolean;
  version?: string;
  uptimeMs?: number;
}

interface PxpipeHealth {
  healthy?: boolean;
}

interface PxpipeWindow {
  requests: number;
  compressed: number;
  bypassed: number;
  tokensBeforeEst: number;
  tokensAfterEst: number;
  tokensSavedEst: number;
  savedPct: number;
  imagesGenerated: number;
  avgCompressionMs: number;
  errors: number;
}

interface PxpipeStats {
  windows?: Record<string, PxpipeWindow>;
  timeline?: Array<{ date: string; tokensSavedEst: number }>;
  recent?: Array<{
    ts: string;
    provider?: string;
    model?: string;
    applied: boolean;
    tokensBeforeEst?: number;
    tokensAfterEst?: number;
    tokensSavedEst?: number;
    savedPct?: number;
    durationMs?: number;
    reason?: string;
    detail?: string;
  }>;
}

interface PxpipeLogs {
  installLog?: string;
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${tone || ""}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </Card>
  );
}

export default function PxpipeClient() {
  const [status, setStatus] = useState<PxpipeStatus | null>(null);
  const [health, setHealth] = useState<PxpipeHealth | null>(null);
  const [stats, setStats] = useState<PxpipeStats | null>(null);
  const [logs, setLogs] = useState<PxpipeLogs | null>(null);
  const [windowId, setWindowId] = useState("last7d");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, statsRes, logsRes] = await Promise.all([
        fetch("/api/pxpipe/status", { headers: { "Cache-Control": "no-store" } }),
        fetch("/api/pxpipe/stats"),
        fetch("/api/pxpipe/logs?limit=50"),
      ]);
      setStatus(await statusRes.json());
      setStats(await statsRes.json());
      setLogs(await logsRes.json());
      const healthRes = await fetch("/api/pxpipe/health", { method: "POST" });
      setHealth(await healthRes.json());
    } catch {
      /* sections render placeholders */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const w = stats?.windows?.[windowId];
  const statusLabel = !status
    ? "—"
    : !status.installed
      ? (translate("Not installed") || "Not installed")
      : health?.healthy
        ? (translate("Healthy") || "Healthy")
        : status.running
          ? (translate("Running") || "Running")
          : (translate("Stopped") || "Stopped");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ImageIcon className="size-4" />
          PXPIPE Dashboard
        </h2>
        <div className="flex items-center gap-2">
          <a href="/dashboard/token-saver" className="text-xs text-primary underline hover:opacity-80">
            {translate("Token Saver settings") || "Token Saver settings"}
          </a>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            {loading ? (translate("Refreshing…") || "Refreshing…") : (translate("Refresh") || "Refresh")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label={translate("Status") || "Status"}
          value={statusLabel}
          tone={health?.healthy ? "text-success" : status?.installed ? "text-warning" : "text-text-muted"}
          sub={status?.enabled ? (translate("Enabled in pipeline") || "Enabled in pipeline") : (translate("Disabled in pipeline") || "Disabled in pipeline")}
        />
        <SummaryCard label={translate("Version") || "Version"} value={status?.version ? `v${status.version}` : "—"} sub="pxpipe-proxy" />
        <SummaryCard label={translate("Uptime") || "Uptime"} value={fmtUptime(status?.uptimeMs)} sub={translate("module loaded") || "module loaded"} />
        <SummaryCard label={translate("Requests") || "Requests"} value={w ? w.requests.toLocaleString() : "—"} />
        <SummaryCard label={translate("Compressed") || "Compressed"} value={w ? w.compressed.toLocaleString() : "—"} tone="text-success" />
        <SummaryCard label={translate("Bypassed") || "Bypassed"} value={w ? w.bypassed.toLocaleString() : "—"} />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-medium">{translate("Token savings (estimated)") || "Token savings (estimated)"}</h3>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
            {WINDOW_TABS.map((tab) => (
              <Button
                key={tab.id}
                variant={windowId === tab.id ? "default" : "ghost"}
                size="xs"
                onClick={() => setWindowId(tab.id)}
              >
                {translate(tab.label) || tab.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-text-muted">{translate("Original tokens") || "Original tokens"}</p>
            <p className="text-lg font-semibold">{w ? fmtTokens(w.tokensBeforeEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">{translate("After PXPIPE") || "After PXPIPE"}</p>
            <p className="text-lg font-semibold">{w ? fmtTokens(w.tokensAfterEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">{translate("Saved") || "Saved"}</p>
            <p className="text-lg font-semibold text-success">{w ? fmtTokens(w.tokensSavedEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">{translate("Reduction") || "Reduction"}</p>
            <p className="text-lg font-semibold text-success">{w ? `${w.savedPct}%` : "—"}</p>
          </div>
        </div>
        <p className="text-xs text-text-muted mt-3">
          {translate("Estimates of body size before/after image; usage charged per request (recorded on the Usage page) remains the ground truth.") || "Estimates of body size before/after image; usage charged per request (recorded on the Usage page) remains the ground truth."}{" "}
          {translate("Images generated:") || "Images generated:"}{" "}
          {w ? w.imagesGenerated.toLocaleString() : "—"} · {translate("Average compression time:") || "Average compression time:"}{" "}
          {w ? `${w.avgCompressionMs}ms` : "—"} · {translate("Errors:") || "Errors:"} {w ? w.errors : "—"}
        </p>
      </Card>

      <Card className="p-4">
        <h3 className="font-medium mb-3">{translate("Tokens saved — last 30 days") || "Tokens saved — last 30 days"}</h3>
        {stats?.timeline?.some((d) => d.tokensSavedEst > 0) ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.timeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
        ) : (
          <div className="h-32 flex items-center justify-center text-text-muted text-sm">
            {translate("No savings recorded yet — enable PXPIPE in Token Saver and route a large request in Claude format.") || "No savings recorded yet — enable PXPIPE in Token Saver and route a large request in Claude format."}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-medium mb-3">{translate("History") || "History"}</h3>
          <Table>
            <TableHeader>
              <TableRow className="text-xs text-text-muted">
                <TableHead className="py-2 pr-3">{translate("Time") || "Time"}</TableHead>
                <TableHead className="py-2 pr-3">{translate("Model") || "Model"}</TableHead>
                <TableHead className="py-2 pr-3 text-right">{translate("Original") || "Original"}</TableHead>
                <TableHead className="py-2 pr-3 text-right">{translate("Compressed") || "Compressed"}</TableHead>
                <TableHead className="py-2 pr-3 text-right">{translate("Saved") || "Saved"}</TableHead>
                <TableHead className="py-2 pr-3 text-right">%</TableHead>
                <TableHead className="py-2 pr-3 text-right">{translate("Duration") || "Duration"}</TableHead>
                <TableHead className="py-2">{translate("Status") || "Status"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(stats?.recent || []).slice(0, 50).map((ev, i) => (
                <TableRow key={`${ev.ts}-${i}`}>
                  <TableCell className="py-1.5 pr-3 text-text-muted">
                    {new Date(ev.ts).toLocaleString()}
                  </TableCell>
                  <TableCell className="py-1.5 pr-3 font-mono text-xs">{ev.provider ? `${ev.provider}/${ev.model}` : ev.model || "—"}</TableCell>
                  <TableCell className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.applied ? fmtTokens(ev.tokensBeforeEst) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.applied ? fmtTokens(ev.tokensAfterEst) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 pr-3 text-right font-mono text-xs text-success">
                    {ev.applied ? fmtTokens(ev.tokensSavedEst) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.applied ? `${ev.savedPct}%` : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.durationMs != null ? `${ev.durationMs}ms` : "—"}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        ev.applied
                          ? "bg-success/15 text-success"
                          : ev.reason === "transform_error" || ev.reason === "timeout"
                            ? "bg-danger/15 text-danger"
                            : "bg-warning/15 text-warning"
                      }`}
                      title={ev.detail || ""}
                    >
                      {ev.applied ? (translate("Compressed") || "Compressed") : (REASON_LABELS as Record<string, string>)[ev.reason ?? ""] ? (translate((REASON_LABELS as Record<string, string>)[ev.reason ?? ""]) || (REASON_LABELS as Record<string, string>)[ev.reason ?? ""]) : ev.reason}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {(!stats?.recent || stats.recent.length === 0) && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-text-muted text-sm">
                    {translate("No PXPIPE activity yet") || "No PXPIPE activity yet"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </Card>

      <Card className="p-4" id="logs">
        <h3 className="font-medium mb-3">{translate("PXPIPE Logs") || "PXPIPE Logs"}</h3>
        {logs?.installLog ? (
          <pre className="rounded bg-black/5 dark:bg-white/5 p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
            {logs.installLog}
          </pre>
        ) : (
          <p className="text-sm text-text-muted">{translate("No install log yet.") || "No install log yet."}</p>
        )}
      </Card>
    </div>
  );
}
