"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import AbilitiesEditor from "@/shared/components/gateway/AbilitiesEditor";
import {
  normalizeGatewayProfile,
  profileFromSettings,
  type GatewayAbilities,
} from "@/shared/gateway/gatewayProfile";
import type { ChatSession, HarnessPluginSettings } from "../types";

type Props = {
  session: ChatSession | null;
  onUpdate: (settings: HarnessPluginSettings) => void;
};

/**
 * The token savers for this conversation. They used to be one account-wide
 * page shared with the public API; now the API configures them per key on the
 * Endpoint page and each chat configures its own here. A conversation that
 * never touched them shows — and runs with — the account default.
 */
export default function ChatAbilitiesPanel({ session, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { data: settings } = useSWR<Record<string, unknown>>("/api/settings", jsonFetcher);
  const accountDefault = profileFromSettings(settings ?? {});
  const value: GatewayAbilities = normalizeGatewayProfile(
    { abilities: session?.pluginSettings?.abilities },
    accountDefault,
  ).abilities;
  const customized = Boolean(session?.pluginSettings?.abilities);

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex min-h-24 w-full items-center justify-between gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls="chat-abilities-configuration"
      >
        <span>
          <span className="block text-lg font-semibold">Economizador de tokens</span>
          <span className="mt-1 block text-sm leading-6 text-muted-foreground">
            RTK, Caveman, Ponytail, Synapse e MetaBreak nesta conversa.{" "}
            {customized ? "Ajustado para este chat." : "Usando o padrão da conta."}
          </span>
        </span>
        <ChevronDown
          className={cn("size-5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div id="chat-abilities-configuration" className="border-t border-border px-5 py-5">
          <AbilitiesEditor
            value={value}
            disabled={!session || !settings}
            onChange={(abilities) => onUpdate({ abilities })}
          />
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Vale só para este chat, a partir da próxima mensagem. As chaves de API configuram as
            próprias habilidades na página Ponto de extremidade.
          </p>
        </div>
      ) : null}
    </section>
  );
}
