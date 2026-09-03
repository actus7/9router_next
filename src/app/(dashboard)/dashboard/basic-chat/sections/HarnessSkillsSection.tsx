"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  resolveSessionSkillsFrom,
  getActiveSkillCatalog,
  type AgentSkillDefinition,
} from "@/shared/harness/agentSkills";
import {
  useAgentSkills,
  type SkillDraft,
} from "../hooks/useAgentSkills";
import type { ChatSession } from "../types";
import SkillEditorPanel from "./SkillEditorPanel";

function skillBadge(skill: AgentSkillDefinition): string {
  if (skill.bundled) return "Padrão";
  if (skill.origin === "imported") return "Importada";
  return "Sua";
}

export default function HarnessSkillsSection({
  session,
  updateSession,
}: {
  session: ChatSession | null;
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
}) {
  const skillsHook = useAgentSkills(true);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<SkillDraft | null | "new">(null);

  const effectiveSkills = useMemo(() => {
    const catalog = {
      skills: skillsHook.skills.length
        ? skillsHook.skills
        : getActiveSkillCatalog().skills,
    };
    return resolveSessionSkillsFrom(catalog, session?.skillOverrides);
  }, [skillsHook.skills, session?.skillOverrides]);
  const enabledSessionIds = new Set(effectiveSkills.map((skill) => skill.id));

  const visibleSkills = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const list = skillsHook.skills.length ? skillsHook.skills : getActiveSkillCatalog().skills;
    return normalized
      ? list.filter((skill) =>
          `${skill.id} ${skill.description}`.toLocaleLowerCase().includes(normalized),
        )
      : list;
  }, [query, skillsHook.skills]);

  const toggleSessionSkill = (skillId: string) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      skillOverrides: {
        ...current.skillOverrides,
        [skillId]: !enabledSessionIds.has(skillId),
      },
    }));
  };

  const handleSave = async (draft: SkillDraft) => {
    await skillsHook.saveSkill(draft);
    setEditorDraft(null);
  };

  return (
    <section aria-labelledby="skills-heading">
      <h2 id="skills-heading" className="text-2xl font-semibold tracking-tight">
        Skills
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        Agent Skills seguem o formato SKILL.md: descrições entram no prompt;
        o modelo carrega o corpo com <code className="text-xs">load_skill</code>.
      </p>
      <p className="mt-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Toggle no card = nesta sessão. No painel expandido, toggle global =
        instalação inteira. Skills importadas entram desativadas por padrão.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="relative block min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 pl-9"
            placeholder="Buscar skills"
            type="search"
          />
        </label>
        <Button type="button" variant="outline" onClick={() => setEditorDraft("new")}>
          <Plus className="size-4" />
          Nova skill
        </Button>
      </div>

      {skillsHook.error ? (
        <p className="mt-3 text-sm text-destructive">{skillsHook.error}</p>
      ) : null}
      {skillsHook.loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Carregando skills…</p>
      ) : null}

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {visibleSkills.map((skill) => {
          const sessionEnabled = enabledSessionIds.has(skill.id);
          const expanded = expandedId === skill.id;
          const busy = skillsHook.busyId === skill.id;
          return (
            <li
              key={skill.id}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="flex min-h-20 items-center gap-3 p-4">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    setExpandedId((current) =>
                      current === skill.id ? null : skill.id,
                    )
                  }
                  aria-expanded={expanded}
                >
                  <p className="flex items-center gap-2 truncate font-medium">
                    {skill.id}
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      {skillBadge(skill)}
                    </span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {skill.description}
                  </p>
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant={sessionEnabled ? "secondary" : "outline"}
                  className={cn(
                    "shrink-0",
                    sessionEnabled && "text-emerald-700 dark:text-emerald-400",
                  )}
                  onClick={() => toggleSessionSkill(skill.id)}
                  disabled={!session}
                  aria-pressed={sessionEnabled}
                >
                  {sessionEnabled ? "Sessão" : "Off sessão"}
                </Button>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                  onClick={() =>
                    setExpandedId((current) =>
                      current === skill.id ? null : skill.id,
                    )
                  }
                  aria-label={`Detalhes de ${skill.id}`}
                >
                  {expanded ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
              </div>
              {expanded ? (
                <div className="border-t border-border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
                  <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1">
                    <dt>Global</dt>
                    <dd>
                      <Button
                        size="sm"
                        variant={skill.enabled ? "secondary" : "outline"}
                        disabled={busy}
                        onClick={() =>
                          void skillsHook.setGlobalEnabled(skill, !skill.enabled)
                        }
                      >
                        {skill.enabled ? "Ativa" : "Inativa"}
                      </Button>
                    </dd>
                    <dt>Origem</dt>
                    <dd>{skill.origin}</dd>
                    {skill.sourceUrl ? (
                      <>
                        <dt>URL</dt>
                        <dd className="break-all font-mono text-foreground">
                          {skill.sourceUrl}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!skill.bundled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditorDraft({
                            id: skill.id,
                            name: skill.name,
                            description: skill.description,
                            body: skill.body,
                            enabled: skill.enabled,
                            source:
                              skill.origin === "imported" ? "imported" : "user",
                            origin: skill.sourceUrl,
                          })
                        }
                      >
                        Editar
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          skillsHook.exportMarkdown(skill),
                        );
                      }}
                    >
                      Copiar SKILL.md
                    </Button>
                    {!skill.bundled ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => void skillsHook.removeSkill(skill.id)}
                      >
                        Remover
                      </Button>
                    ) : skill.origin === "override" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void skillsHook.removeSkill(skill.id)}
                      >
                        Restaurar padrão
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {editorDraft !== null ? (
        <SkillEditorPanel
          draft={editorDraft === "new" ? null : editorDraft}
          busy={Boolean(skillsHook.busyId)}
          onSave={handleSave}
          onCancel={() => setEditorDraft(null)}
          onImportUrl={skillsHook.importFromUrl}
        />
      ) : null}

      {visibleSkills.length === 0 && !skillsHook.loading ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nenhuma skill encontrada.
        </p>
      ) : null}
    </section>
  );
}
