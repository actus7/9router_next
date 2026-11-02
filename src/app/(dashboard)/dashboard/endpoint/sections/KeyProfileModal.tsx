"use client";

import useSWR from "swr";
import Modal from "@/shared/components/Modal";
import AbilitiesEditor from "@/shared/components/gateway/AbilitiesEditor";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { translate } from "@/i18n/runtime";
import type { AgentSkillDefinition } from "@/shared/harness/agentSkills";
import type { UseKeyProfileReturn } from "../hooks/useKeyProfile";

export type KeyProfileTab = "features" | "skills";

type Props = {
  keyName: string | null;
  tab: KeyProfileTab;
  onTabChange: (tab: KeyProfileTab) => void;
  state: UseKeyProfileReturn;
  onClose: () => void;
};

const t = (text: string): string => translate(text) || text;

// ponytail: chars/4 is the usual rough token estimate; good enough for a warning.
const approxTokens = (text: string): number => Math.ceil(text.length / 4);

const TAB_CLASS =
  "shrink-0 flex-none px-4 rounded-[8px] font-medium transition-all h-9 text-sm data-active:bg-surface data-active:text-text-main data-active:shadow-sm text-text-muted hover:text-text-main";

/**
 * One key, one profile (`apiKeys.profile`): token savers + guardrail under
 * "Features", Agent Skills under "Skills". Access ceilings stay in the
 * separate Access dialog — that is policy, not profile.
 */
export default function KeyProfileModal({ keyName, tab, onTabChange, state, onClose }: Props) {
  const { profile, error } = state;
  return (
    <Modal isOpen={keyName !== null} onClose={onClose} title={`${t("Profile")} · ${keyName ?? ""}`} size="2xl">
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as KeyProfileTab)} className="mb-4 inline-flex w-full sm:w-auto">
        <TabsList variant="default" className="rounded-[10px] bg-surface-2 p-1">
          <TabsTrigger value="features" className={TAB_CLASS}>{t("Features")}</TabsTrigger>
          <TabsTrigger value="skills" className={TAB_CLASS}>{t("Skills")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "features" ? <FeaturesPanel state={state} /> : <SkillsPanel state={state} />}
      {error && profile ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {`${t("Could not save")}: ${error}. ${t("The previous setting was kept.")}`}
        </p>
      ) : null}
    </Modal>
  );
}

function FeaturesPanel({ state }: { state: UseKeyProfileReturn }) {
  const { profile, loading, saving, error, save } = state;
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("These apply only to requests made with this key. Each chat configures its own abilities in the conversation's plugins.")}
      </p>
      {loading || !profile ? (
        <p className="text-sm text-muted-foreground">{error || t("Loading...")}</p>
      ) : (
        <>
          <AbilitiesEditor value={profile.abilities} disabled={saving} onChange={(abilities) => void save({ abilities })} />
          {/* The guardrail sits on the key's profile, not on the shared abilities
              editor: the chat has its own scanning and must not see this. */}
          <label className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="flex-1">
              <span className="font-medium">{t("Content guardrail")}</span>
              <span className="block text-xs text-muted-foreground">{t("Scans user input on this key's requests (adds latency)")}</span>
            </span>
            <Switch
              className="ms-auto"
              checked={profile.guardrails === true}
              disabled={saving}
              onCheckedChange={(guardrails) => void save({ guardrails })}
              aria-label={t("Content guardrail")}
            />
          </label>
        </>
      )}
    </>
  );
}

/** Picks from the account's installed skills; installing stays in the chat's skill library. */
function SkillsPanel({ state }: { state: UseKeyProfileReturn }) {
  const { profile, loading, saving, error, save } = state;
  const { data, error: skillsError } = useSWR<{ skills: AgentSkillDefinition[] }>("/api/harness/skills", jsonFetcher);
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
    <>
      <p className="text-sm text-muted-foreground">
        {t("On the API, each skill goes whole into the system prompt of every request made with this key: the client runs the tools, so there is no on-demand loading as in the chat.")}
      </p>
      <p className="mt-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {`${t("Selected")}: ${selected.size} · ~${selectedTokens.toLocaleString()} ${t("extra tokens per request.")} ${t("To install new skills, use the Skill Library in the chat.")}`}
      </p>
      {skillsError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">{t("Could not load skills.")}</p>
      ) : loading || !profile || !data ? (
        <p className="mt-4 text-sm text-muted-foreground">{error || t("Loading...")}</p>
      ) : skills.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("No skills installed in this account.")}</p>
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
    </>
  );
}
