"use client";

import useSWR from "swr";
import Modal from "@/shared/components/Modal";
import { Checkbox } from "@/components/ui/checkbox";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import type { AgentSkillDefinition } from "@/shared/harness/agentSkills";
import type { UseKeyProfileReturn } from "../hooks/useKeyProfile";

type Props = {
  keyName: string | null;
  state: UseKeyProfileReturn;
  onClose: () => void;
};

// ponytail: chars/4 is the usual rough token estimate; good enough for a warning.
const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Which installed skills ride along with this key's requests. Installing stays
 * account-wide (the chat's skill library); this only picks from that catalog.
 */
export default function KeySkillsModal({ keyName, state, onClose }: Props) {
  const { profile, loading, saving, error, save } = state;
  const { data } = useSWR<{ skills: AgentSkillDefinition[] }>(
    keyName !== null ? "/api/harness/skills" : null,
    jsonFetcher,
  );
  const skills = data?.skills ?? [];
  const selected = new Set(profile?.skillIds ?? []);
  const selectedTokens = skills
    .filter((skill) => selected.has(skill.id))
    .reduce((sum, skill) => sum + approxTokens(skill.body), 0);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    void save({ skillIds: [...next] });
  };

  return (
    <Modal isOpen={keyName !== null} onClose={onClose} title={`Skills · ${keyName ?? ""}`} size="xl">
      <p className="text-sm text-muted-foreground">
        Na API, a skill vai inteira no prompt de sistema de toda requisição desta chave: quem executa
        as ferramentas é o cliente, então não há carregamento sob demanda como no chat.
      </p>
      <p className="mt-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Selecionadas: {selected.size} · ~{selectedTokens.toLocaleString()} tokens a mais por requisição.
        Para instalar novas skills, use a Biblioteca de Skills no chat.
      </p>
      {loading || !profile || !data ? (
        <p className="mt-4 text-sm text-muted-foreground">{error || "Carregando…"}</p>
      ) : skills.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhuma skill instalada nesta conta.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {skills.map((skill) => (
            <li key={skill.id} className="flex items-start gap-3 py-3">
              <Checkbox
                id={`key-skill-${skill.id}`}
                checked={selected.has(skill.id)}
                disabled={saving}
                onCheckedChange={(checked) => toggle(skill.id, checked === true)}
              />
              <label htmlFor={`key-skill-${skill.id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{skill.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    ~{approxTokens(skill.body).toLocaleString()} tokens
                  </span>
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{skill.description}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && profile ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Não foi possível salvar: {error}. A seleção anterior foi mantida.
        </p>
      ) : null}
    </Modal>
  );
}
