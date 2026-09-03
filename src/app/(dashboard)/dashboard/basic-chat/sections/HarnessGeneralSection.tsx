"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { HarnessSettingsDialogProps } from "./harnessSettingsTypes";

export function GeneralSection({
  systemPrompt,
  setSystemPrompt,
  temperature,
  setTemperature,
  conversationDisplay,
  setConversationDisplay,
  enterBehavior,
  setEnterBehavior,
}: HarnessSettingsDialogProps) {
  return (
    <section aria-labelledby="general-heading" className="max-w-3xl">
      <h2
        id="general-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Geral
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Preferências que definem como o chat exibe e conduz uma conversa.
      </p>
      <div className="mt-7 divide-y divide-border border-y border-border">
        <SettingRow
          title="Exibição da conversa"
          description="Controla como o conteúdo de processo aparece em turnos concluídos."
        >
          <Select
            value={conversationDisplay}
            onValueChange={(value) =>
              setConversationDisplay(value as "normal" | "compact")
            }
          >
            <SelectTrigger aria-label="Exibição da conversa" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="normal">Detalhada</SelectItem>
              <SelectItem value="compact">Compacta</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Enter durante execução"
          description="Enquanto o agente executa: Fila aguarda o fim; Direcionar interrompe e envia a nova instrução."
        >
          <Select
            value={enterBehavior}
            onValueChange={(value) =>
              setEnterBehavior(value as "queue" | "steer")
            }
          >
            <SelectTrigger
              aria-label="Enter durante execução"
              className="w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="queue">Fila</SelectItem>
              <SelectItem value="steer">Direcionar</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
      <section className="mt-8" aria-labelledby="agent-settings-heading">
        <h3 id="agent-settings-heading" className="text-base font-semibold">
          Instruções do agente
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Aplicadas à próxima execução quando o plugin Agent instructions
          estiver ativo.
        </p>
        <label
          className="mt-4 block text-sm font-medium"
          htmlFor="chat-system-prompt"
        >
          Prompt de sistema
        </label>
        <Textarea
          id="chat-system-prompt"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder="You are a helpful assistant..."
          rows={4}
          className="mt-2 resize-y"
        />
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <label htmlFor="chat-temperature" className="text-sm font-medium">
            Temperatura
          </label>
          <input
            id="chat-temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
            className="h-1.5 min-w-48 flex-1 accent-primary"
          />
          <span className="w-8 text-right text-xs text-muted-foreground">
            {temperature.toFixed(1)}
          </span>
        </div>
      </section>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-24 flex-col justify-center gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}
