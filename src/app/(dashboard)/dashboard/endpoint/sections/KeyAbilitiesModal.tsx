"use client";

import Modal from "@/shared/components/Modal";
import AbilitiesEditor from "@/shared/components/gateway/AbilitiesEditor";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { UseKeyProfileReturn } from "../hooks/useKeyProfile";

type Props = {
  keyName: string | null;
  state: UseKeyProfileReturn;
  onClose: () => void;
};

/** Token savers for one API key. The chat configures its own, per conversation. */
export default function KeyAbilitiesModal({ keyName, state, onClose }: Props) {
  const { profile, loading, saving, error, save } = state;
  return (
    <Modal isOpen={keyName !== null} onClose={onClose} title={`Habilidades · ${keyName ?? ""}`} size="2xl">
      <p className="mb-4 text-sm text-muted-foreground">
        Valem só para as requisições feitas com esta chave. Cada chat configura as próprias
        habilidades nos plugins da conversa.
      </p>
      {loading || !profile ? (
        <p className="text-sm text-muted-foreground">{error || "Carregando…"}</p>
      ) : (
        <>
          <AbilitiesEditor
            value={profile.abilities}
            disabled={saving}
            onChange={(abilities) => void save({ abilities })}
          />
          {/* The guardrail sits on the key's profile, not on the shared abilities
              editor: the chat has its own scanning and must not see this. */}
          <label className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="flex-1">
              <span className="font-medium">{translate("Content guardrail") || "Content guardrail"}</span>
              <span className="block text-xs text-muted-foreground">
                {translate("Scans user input on this key's requests (adds latency)") ||
                  "Scans user input on this key's requests (adds latency)"}
              </span>
            </span>
            <Switch
              className="ms-auto"
              checked={profile.guardrails === true}
              disabled={saving}
              onCheckedChange={(guardrails) => void save({ guardrails })}
              aria-label={translate("Content guardrail") || "Content guardrail"}
            />
          </label>
        </>
      )}
      {error && profile ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Não foi possível salvar: {error}. A configuração anterior foi mantida.
        </p>
      ) : null}
    </Modal>
  );
}
