import type { RuntimeToolDefinition } from "./agentPlugins";
import { BUNDLE_SKILLS } from "./bundleSkills";
import {
  readSkillPreferences,
  resolveSkillSessionEnabled,
  type SkillPreferenceMap,
} from "./skillPreferences";

export { resolveSkillSessionEnabled } from "./skillPreferences";
export type { SkillPreferenceMap } from "./skillPreferences";

export interface AgentSkillDefinition {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  origin: "bundle" | "override" | "user" | "imported";
  bundled?: boolean;
  sourceUrl?: string;
}

export interface SkillPatchRow {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  source: "override" | "user" | "imported";
  origin?: string;
}

export interface SkillCatalog {
  skills: readonly AgentSkillDefinition[];
}

export interface SkillCompositionDiagnostic {
  rowId: string;
  reason: string;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function isValidSkillSlug(id: string): boolean {
  return SLUG_PATTERN.test(id);
}

export const BUNDLE_CATALOG: SkillCatalog = {
  skills: BUNDLE_SKILLS,
};

let activeCatalog: SkillCatalog = BUNDLE_CATALOG;

export function setActiveSkillCatalog(catalog: SkillCatalog): void {
  activeCatalog = catalog;
}

export function getActiveSkillCatalog(): SkillCatalog {
  return activeCatalog;
}

export function resetActiveSkillCatalog(): void {
  activeCatalog = BUNDLE_CATALOG;
}

/** Merges bundled defaults with stored patch rows. Empty patch reproduces the bundle. */
export function composeSkills(
  bundle: readonly AgentSkillDefinition[],
  patchRows: readonly SkillPatchRow[],
): { skills: AgentSkillDefinition[]; diagnostics: SkillCompositionDiagnostic[] } {
  const byId = new Map<string, AgentSkillDefinition>(
    bundle.map((skill) => [skill.id, { ...skill }]),
  );
  const diagnostics: SkillCompositionDiagnostic[] = [];

  for (const row of patchRows) {
    if (!isValidSkillSlug(row.id)) {
      diagnostics.push({ rowId: row.id, reason: "invalid skill id slug" });
      continue;
    }
    const bundled = byId.get(row.id);
    if (row.source === "override" && bundled?.bundled) {
      byId.set(row.id, {
        ...bundled,
        enabled: row.enabled,
        origin: "override",
      });
      continue;
    }
    if (bundled?.bundled && row.source !== "override") {
      diagnostics.push({
        rowId: row.id,
        reason: "cannot replace bundled skill; use override to toggle enabled",
      });
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      description: row.description,
      body: row.body,
      enabled: row.enabled,
      origin: row.source,
      bundled: false,
      sourceUrl: row.origin,
    });
  }

  return {
    skills: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics,
  };
}

export function resolveSessionSkillsFrom(
  catalog: SkillCatalog,
  sessionOverrides?: Record<string, boolean>,
  preferences?: SkillPreferenceMap,
): AgentSkillDefinition[] {
  const prefs = preferences ?? readSkillPreferences();
  return catalog.skills.filter((skill) =>
    resolveSkillSessionEnabled(skill, prefs, sessionOverrides),
  );
}

export function resolveSessionSkills(
  sessionOverrides?: Record<string, boolean>,
  preferences?: SkillPreferenceMap,
): AgentSkillDefinition[] {
  return resolveSessionSkillsFrom(activeCatalog, sessionOverrides, preferences);
}

export function buildSkillsPromptBlock(
  skills: readonly AgentSkillDefinition[],
): string {
  if (skills.length === 0) return "";
  const lines = skills.map(
    (skill) => `- ${skill.id}: ${skill.description.trim()}`,
  );
  return [
    "Available Agent Skills (descriptions only — call load_skill with the skill id before following its instructions):",
    ...lines,
  ].join("\n");
}

const skillTool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): RuntimeToolDefinition => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});

export function getUpdateSkillToolDefinition(): RuntimeToolDefinition {
  return skillTool(
    "update_skill",
    "Update an existing user-created Agent Skill. Cannot modify bundled skill content.",
    {
      name: { type: "string", description: "Skill id to update." },
      description: { type: "string", description: "New description, if changing." },
      body: { type: "string", description: "New markdown body, if changing." },
      enabled: {
        type: "boolean",
        description: "Global enabled flag, if changing.",
      },
    },
    ["name"],
  );
}

export function getPatchSkillToolDefinition(): RuntimeToolDefinition {
  return skillTool(
    "patch_skill",
    "Apply a partial markdown patch to an existing user skill body (append or replace section).",
    {
      name: { type: "string", description: "Skill id to patch." },
      patch: {
        type: "string",
        description: "Markdown fragment to append or substitute.",
      },
      mode: {
        type: "string",
        enum: ["append", "replace"],
        description: "append (default) adds to the end; replace substitutes entire body.",
      },
    },
    ["name", "patch"],
  );
}

export function getLearnSkillToolDefinition(): RuntimeToolDefinition {
  return skillTool(
    "learn_skill",
    "Capture a reusable lesson as a new Agent Skill from a concise name, description, and instructions.",
    {
      name: { type: "string", description: "New skill id (kebab-case)." },
      description: { type: "string", description: "When to use this skill." },
      lesson: {
        type: "string",
        description: "Instruction body distilled from the conversation.",
      },
    },
    ["name", "description", "lesson"],
  );
}

export function getLoadSkillFileToolDefinition(): RuntimeToolDefinition {
  return skillTool(
    "load_skill_file",
    "Load an auxiliary file attached to a multi-file Agent Skill.",
    {
      name: { type: "string", description: "Skill id." },
      path: { type: "string", description: "Relative file path within the skill." },
    },
    ["name", "path"],
  );
}

export function getSupplementalSkillAuthoringTools(): RuntimeToolDefinition[] {
  return [
    getUpdateSkillToolDefinition(),
    getPatchSkillToolDefinition(),
    getLearnSkillToolDefinition(),
  ];
}

export function getSkillRuntimeToolDefinitions(options: {
  includeLoad?: boolean;
  includeAuthoring?: boolean;
}): RuntimeToolDefinition[] {
  const tools: RuntimeToolDefinition[] = [];
  if (options.includeLoad) {
    tools.push(
      skillTool(
        "load_skill",
        "Load the full instructions for an Agent Skill by id. Call this before applying a skill listed in the system prompt.",
        {
          name: {
            type: "string",
            description: "Skill id (kebab-case slug from the available skills list).",
          },
        },
        ["name"],
      ),
    );
  }
  if (options.includeAuthoring) {
    tools.push(
      skillTool(
        "create_skill",
        "Create a new Agent Skill stored in ModelHub. Use after drafting content with the skill-creator guidance.",
        {
          name: { type: "string", description: "Unique skill id (kebab-case)." },
          description: {
            type: "string",
            description: "Short description shown before load_skill (~30 tokens).",
          },
          body: {
            type: "string",
            description: "Markdown body (instructions). Frontmatter optional.",
          },
        },
        ["name", "description", "body"],
      ),
      skillTool(
        "update_skill",
        "Update an existing user-created Agent Skill. Cannot modify bundled skills except via UI toggle.",
        {
          name: { type: "string", description: "Skill id to update." },
          description: { type: "string", description: "New description, if changing." },
          body: { type: "string", description: "New markdown body, if changing." },
          enabled: {
            type: "boolean",
            description: "Global enabled flag, if changing.",
          },
        },
        ["name"],
      ),
    );
  }
  return tools;
}

export function getEnabledSkillIds(
  sessionOverrides?: Record<string, boolean>,
  preferences?: SkillPreferenceMap,
): Set<string> {
  return new Set(resolveSessionSkills(sessionOverrides, preferences).map((skill) => skill.id));
}
