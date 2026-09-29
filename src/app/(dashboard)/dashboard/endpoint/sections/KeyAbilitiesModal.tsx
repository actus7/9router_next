"use client";

import Modal from "@/shared/components/Modal";
import AbilitiesEditor from "@/shared/components/gateway/AbilitiesEditor";
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
    <Modal isOpen={keyName !== null} onClose={onClose} title={`Habilidades · ${keyName ?? ""}`} size="xl">
      <p className="mb-4 text-sm text-muted-foreground">
        Valem só para as requisições feitas com esta chave. Cada chat configura as próprias
        habilidades nos plugins da conversa.
      </p>
      {loading || !profile ? (
        <p className="text-sm text-muted-foreground">{error || "Carregando…"}</p>
      ) : (
        <AbilitiesEditor
          value={profile.abilities}
          disabled={saving}
          onChange={(abilities) => void save({ abilities })}
        />
      )}
      {error && profile ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Não foi possível salvar: {error}. A configuração anterior foi mantida.
        </p>
      ) : null}
    </Modal>
  );
}
