"use client";

import { useState } from "react";
import { Brain, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryEntryView } from "@/shared/harness/agentMemory";
import type { HarnessPendingWrite } from "@/shared/harness/pendingWrites";
import type { HarnessEvent } from "../types";
import { eventLabel } from "../runJournalHelpers";
import { useAgentMemory } from "../hooks/useAgentMemory";

function pendingCopy(item: HarnessPendingWrite): {
  title: string;
  detail: string;
  approveLabel: string;
} {
  if (item.kind === "plugin" && item.action === "toggle") {
    return {
      title: `${item.payload.enabled ? "Ativar" : "Desativar"} plugin`,
      detail: item.payload.pluginId,
      approveLabel: "Aplicar",
    };
  }
  if (item.kind === "plugin" && item.action === "propose") {
    return {
      title: item.payload.title,
      detail: `${item.payload.description}\nTool proposta: ${item.payload.toolName}. A aceitação registra a proposta, mas não instala código executável.`,
      approveLabel: "Aceitar proposta",
    };
  }
  if (item.kind === "memory") {
    return {
      title: `${item.action} · ${item.payload.scope ?? item.payload.id ?? "memória"}`,
      detail: item.payload.content ?? "",
      approveLabel: "Aprovar",
    };
  }
  return {
    title: `${item.action} · skill`,
    detail: String(item.payload.id ?? item.payload.name ?? ""),
    approveLabel: "Aprovar",
  };
}

function MemoryScopeSection({
  title,
  entries,
  chars,
  limit,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: {
  title: string;
  entries: readonly MemoryEntryView[];
  chars: number;
  limit: number;
  busy: boolean;
  onCreate: (content: string) => Promise<void>;
  onUpdate: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {chars}/{limit} caracteres
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm"
          >
            {editingId === entry.id ? (
              <div className="space-y-2">
                <Textarea
                  value={editContent}
                  onChange={(event) => setEditContent(event.target.value)}
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !editContent.trim()}
                    onClick={() => {
                      void onUpdate(entry.id, editContent).then(() => {
                        setEditingId(null);
                        setEditContent("");
                      });
                    }}
                  >
                    Salvar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap leading-6">{entry.content}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditContent(entry.content);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onDelete(entry.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Nova entrada de memória"
          disabled={busy}
        />
        <Button
          size="icon"
          variant="outline"
          disabled={busy || !draft.trim()}
          onClick={() => {
            void onCreate(draft).then(() => setDraft(""));
          }}
          aria-label="Adicionar memória"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default function HarnessMemorySection({
  harnessEvents = [],
}: {
  harnessEvents?: HarnessEvent[];
}) {
  const memory = useAgentMemory(true);
  const journeyEvents = harnessEvents.filter(
    (event) =>
      event.type.startsWith("skill/") ||
      event.type.startsWith("memory/") ||
      event.type === "run/complete",
  );

  return (
    <section aria-labelledby="memory-heading">
      <h2 id="memory-heading" className="text-2xl font-semibold tracking-tight">
        Memória
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        Memória curada persistente para o assistente e preferências do usuário.
        O bloco entra no system prompt quando o plugin Memória está ativo.
      </p>

      {memory.error ? (
        <p className="mt-4 text-sm text-destructive">{memory.error}</p>
      ) : null}

      <div className="mt-5 grid gap-4 rounded-xl border border-border p-4">
        <div className="flex items-center gap-3">
          <Brain className="size-5 text-muted-foreground" />
          <span className="font-medium">Governança</span>
        </div>
        <label className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="write-approval">Exigir aprovação para escrita do agente</Label>
            <p className="text-xs text-muted-foreground">
              Escritas via memory_* ficam pendentes até aprovar abaixo.
            </p>
          </div>
          <Switch
            id="write-approval"
            checked={memory.config?.memoryWriteApproval ?? false}
            disabled={memory.busy}
            onCheckedChange={(checked) =>
              void memory.saveConfig({ memoryWriteApproval: checked })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <Label htmlFor="agent-memory">Memória do agente</Label>
          <Switch
            id="agent-memory"
            checked={memory.config?.memoryAgentEnabled ?? true}
            disabled={memory.busy}
            onCheckedChange={(checked) =>
              void memory.saveConfig({ memoryAgentEnabled: checked })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <Label htmlFor="learning-review">Review pós-turno</Label>
          <Switch
            id="learning-review"
            checked={memory.config?.learningReviewEnabled ?? false}
            disabled={memory.busy}
            onCheckedChange={(checked) =>
              void memory.saveConfig({ learningReviewEnabled: checked })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <Label htmlFor="user-memory">Memória do usuário</Label>
          <Switch
            id="user-memory"
            checked={memory.config?.memoryUserEnabled ?? true}
            disabled={memory.busy}
            onCheckedChange={(checked) =>
              void memory.saveConfig({ memoryUserEnabled: checked })
            }
          />
        </label>
      </div>

      {memory.pending.length > 0 ? (
        <div className="mt-6 space-y-3">
          <h3 className="font-medium">Pendentes de aprovação</h3>
          {memory.pending.map((item) => {
            const copy = pendingCopy(item);
            return (
              <div
                key={item.id}
                className="rounded-lg border border-border bg-muted/40 p-3 text-sm"
              >
              <p className="font-medium">{copy.title}</p>
              {copy.detail ? (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{copy.detail}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={memory.busy}
                  onClick={() => void memory.approvePending(item.id)}
                >
                  {copy.approveLabel}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={memory.busy}
                  onClick={() => void memory.rejectPending(item.id)}
                >
                  Rejeitar
                </Button>
              </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {journeyEvents.length > 0 ? (
        <div className="mt-6 space-y-2">
          <h3 className="font-medium">Journey (sessão atual)</h3>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-xs">
            {journeyEvents.slice(-12).map((event) => (
              <li key={`${event.seq}-${event.type}`} className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {eventLabel(event.type)}
                </span>
                {typeof event.data.name === "string" ? ` · ${event.data.name}` : null}
                {typeof event.data.content === "string"
                  ? ` — ${String(event.data.content).slice(0, 80)}`
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {memory.loading || !memory.snapshot ? (
        <p className="mt-6 text-sm text-muted-foreground">Carregando memória…</p>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={memory.busy}
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify(memory.snapshot, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "modelhub-memory-export.json";
                anchor.click();
                URL.revokeObjectURL(url);
              }}
            >
              Exportar JSON
            </Button>
          </div>
          <MemoryScopeSection
            title="Agente"
            entries={memory.snapshot.agent}
            chars={memory.snapshot.agentChars}
            limit={memory.snapshot.agentLimit}
            busy={memory.busy}
            onCreate={(content) => memory.createEntry("agent", content)}
            onUpdate={memory.updateEntry}
            onDelete={memory.deleteEntry}
          />
          <MemoryScopeSection
            title="Usuário"
            entries={memory.snapshot.user}
            chars={memory.snapshot.userChars}
            limit={memory.snapshot.userLimit}
            busy={memory.busy}
            onCreate={(content) => memory.createEntry("user", content)}
            onUpdate={memory.updateEntry}
            onDelete={memory.deleteEntry}
          />
        </div>
      )}
    </section>
  );
}
