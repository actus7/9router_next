"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { usePluginComposition, type CompositionRow } from "../hooks/usePluginComposition";

const ORIGIN_LABEL: Record<CompositionRow["origin"], string> = {
  bundle: "Padrão",
  override: "Ajustado",
  user: "Adicionado",
};

function rowTitle(row: CompositionRow): string {
  const title = row.config.title;
  return typeof title === "string" && title ? title : row.id;
}

function rowDescription(row: CompositionRow): string {
  const description = row.config.description;
  if (typeof description === "string" && description) return description;
  const provider = row.config.provider;
  if (typeof provider === "string") return `Executor do provedor ${provider}.`;
  return "";
}

interface PluginCompositionPanelProps {
  /** Loads only while the settings dialog is showing this panel. */
  open: boolean;
}

/**
 * Install-wide plugin composition. A change here writes the patch layer, so it
 * survives the process and applies to every conversation, unlike the
 * per-session toggles above it.
 */
export default function PluginCompositionPanel({ open }: PluginCompositionPanelProps) {
  const { rows, diagnostics, bundleRowIds, loading, busyId, error, setRowEnabled, resetRow } =
    usePluginComposition(open);

  const disabledBundleRows = bundleRowIds.filter((id) => !rows.some((row) => row.id === id));

  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold">Composição instalada</h3>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
        Vale para a instalação inteira e fica salva no banco. Os interruptores
        acima ajustam apenas a conversa atual.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {diagnostics.length > 0 ? (
        <div className="mt-3 rounded-lg border border-warning-border bg-warning px-3 py-2">
          <p className="flex items-center gap-2 text-xs font-medium text-warning-foreground">
            <AlertTriangle className="size-3.5" />
            Linhas ignoradas na composição
          </p>
          <ul className="mt-1 space-y-0.5">
            {diagnostics.map((diagnostic) => (
              <li
                key={`${diagnostic.rowId}:${diagnostic.reason}`}
                className="text-xs text-warning-foreground"
              >
                <span className="font-mono">{diagnostic.rowId || "(sem id)"}</span>
                {" — "}
                {diagnostic.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando composição...
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{rowTitle(row)}</span>
                  <Badge
                    variant={row.origin === "bundle" ? "secondary" : "default"}
                    className="shrink-0 text-[10px]"
                  >
                    {ORIGIN_LABEL[row.origin]}
                  </Badge>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {rowDescription(row)}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{row.id}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {row.origin !== "bundle" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Restaurar ${rowTitle(row)}`}
                    disabled={busyId === row.id}
                    onClick={() => void resetRow(row.id)}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                ) : null}
                <Switch
                  checked
                  aria-label={`Desativar ${rowTitle(row)}`}
                  disabled={busyId === row.id}
                  onCheckedChange={() => void setRowEnabled(row, false)}
                />
              </div>
            </li>
          ))}
          {disabledBundleRows.map((id) => (
            <li key={id} className="flex items-center justify-between gap-4 py-3 opacity-60">
              <div className="min-w-0">
                <p className="text-sm font-medium">{id}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Desativado nesta instalação.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyId === id}
                onClick={() => void resetRow(id)}
              >
                Reativar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
