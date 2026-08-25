export const GROK_MAIN_MODEL_SLOT: string = "9router";
export const GROK_BUILTIN_DEFAULT: string = "grok-build";
export const GROK_SUBAGENT_TYPES: readonly string[] = ["general-purpose", "explore", "plan"];

const UNSET_SENTINEL: string = "__9router_unset__";
const MODELS_SECTION: string = "models";
const SUBAGENT_MODELS_SECTION: string = "subagents.models";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tomlString = (value: unknown): string => JSON.stringify(String(value));

const sectionRegExp = (section: string): RegExp =>
  new RegExp(
    `^\\[${escapeRegExp(section)}\\][ \\t]*\\r?\\n((?:(?!\\[)[^\\r\\n]*\\r?\\n?)*)`,
    "m",
  );

const modelSlot = (type: string): string => `${GROK_MAIN_MODEL_SLOT}-${type}`;

const previousDefaultRegExp: RegExp = /^# 9router-prev-default = "([^"]*)"[ \t]*\r?\n?/m;
const previousSubagentRegExp = (type: string): RegExp =>
  new RegExp(
    `^# 9router-prev-subagent-${escapeRegExp(type)} = "([^"]*)"[ \\t]*\\r?\\n?`,
    "m",
  );

interface ModelSection {
  model: string | null;
  base_url: string | null;
  name: string | null;
  api_key: string | null;
  api_backend: string | null;
  context_window: number | null;
  raw: string;
}

interface ModelSectionConfig {
  slot: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  contextWindow?: number;
  name: string;
}

interface SubagentModelOverride {
  model?: string;
  contextWindow?: number;
}

interface GrokBuildConfig {
  model: ModelSection | null;
  default: string | null;
  subagentModels: Record<string, ModelSection | null>;
  subagentMappings: Record<string, string | null>;
}

interface ApplyGrokBuildConfigOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  contextWindow?: number;
  subagentModels?: Record<string, SubagentModelOverride | null>;
}

function getSectionField(toml: string, section: string, key: string): string | null {
  const match: RegExpMatchArray | null = toml.match(sectionRegExp(section));
  if (!match) return null;
  const field: RegExpMatchArray | null = match[1].match(
    new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=[ \\t]*"([^"]*)"`, "m"),
  );
  return field ? field[1] : null;
}

function getSectionNumber(toml: string, section: string, key: string): number | null {
  const match: RegExpMatchArray | null = toml.match(sectionRegExp(section));
  if (!match) return null;
  const field: RegExpMatchArray | null = match[1].match(
    new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=[ \\t]*([0-9]+(?:\\.[0-9]+)?)`, "m"),
  );
  if (!field) return null;
  const value: number = Number(field[1]);
  return Number.isFinite(value) ? value : null;
}

function setSectionField(toml: string, section: string, key: string, value: unknown): string {
  const match: RegExpMatchArray | null = toml.match(sectionRegExp(section));
  const line: string = `${key} = ${tomlString(value)}`;
  if (!match) {
    const prefix: string = toml.length > 0 && !toml.endsWith("\n") ? `${toml}\n` : toml;
    return `${prefix}\n[${section}]\n${line}\n`;
  }

  const body: string = match[1] || "";
  const fieldRegExp: RegExp = new RegExp(
    `^[ \\t]*${escapeRegExp(key)}[ \\t]*=[ \\t]*"[^"]*"`,
    "m",
  );
  const nextBody: string = fieldRegExp.test(body)
    ? body.replace(fieldRegExp, line)
    : `${line}\n${body}`;
  return toml.replace(match[0], `[${section}]\n${nextBody}`);
}

function deleteSectionField(toml: string, section: string, key: string): string {
  const match: RegExpMatchArray | null = toml.match(sectionRegExp(section));
  if (!match) return toml;
  const fieldRegExp: RegExp = new RegExp(
    `^[ \\t]*${escapeRegExp(key)}[ \\t]*=[^\\r\\n]*\\r?\\n?`,
    "m",
  );
  const nextBody: string = (match[1] || "").replace(fieldRegExp, "");
  if (!nextBody.trim()) return toml.replace(match[0], "").replace(/\n{3,}/g, "\n\n");
  return toml.replace(match[0], `[${section}]\n${nextBody}`);
}

function parseModelSection(toml: string, slot: string): ModelSection | null {
  const match: RegExpMatchArray | null = toml.match(sectionRegExp(`model.${slot}`));
  if (!match) return null;
  const body: string = match[1] || "";
  const contextWindow: number | null = getSectionNumber(toml, `model.${slot}`, "context_window");
  return {
    model: getSectionField(toml, `model.${slot}`, "model"),
    base_url: getSectionField(toml, `model.${slot}`, "base_url"),
    name: getSectionField(toml, `model.${slot}`, "name"),
    api_key: getSectionField(toml, `model.${slot}`, "api_key"),
    api_backend: getSectionField(toml, `model.${slot}`, "api_backend"),
    context_window: Number.isFinite(contextWindow) && (contextWindow as number) > 0 ? contextWindow : null,
    raw: body,
  };
}

function buildModelSection({ slot, model, baseUrl, apiKey, contextWindow, name }: ModelSectionConfig): string {
  const lines: string[] = [
    `[model.${slot}]`,
    `model = ${tomlString(model)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `name = ${tomlString(name)}`,
    `description = ${tomlString("Routed via 9Router gateway")}`,
    `api_backend = "chat_completions"`,
  ];
  if (apiKey) lines.push(`api_key = ${tomlString(apiKey)}`);
  if (Number.isFinite(contextWindow) && (contextWindow as number) > 0) {
    lines.push(`context_window = ${Math.floor(contextWindow as number)}`);
  }
  return `${lines.join("\n")}\n`;
}

function upsertModelSection(toml: string, config: ModelSectionConfig): string {
  const regexp: RegExp = sectionRegExp(`model.${config.slot}`);
  const section: string = buildModelSection(config);
  if (regexp.test(toml)) return toml.replace(regexp, section);
  const prefix: string = toml.length > 0 && !toml.endsWith("\n") ? `${toml}\n` : toml;
  return `${prefix}\n${section}`;
}

function removeModelSection(toml: string, slot: string): string {
  return toml.replace(sectionRegExp(`model.${slot}`), "").replace(/\n{3,}/g, "\n\n");
}

function insertMarker(toml: string, marker: string): string {
  const mainSection: RegExp = sectionRegExp(`model.${GROK_MAIN_MODEL_SLOT}`);
  if (mainSection.test(toml)) {
    return toml.replace(mainSection, (section: string) => `${marker}${section}`);
  }
  const prefix: string = toml.length > 0 && !toml.endsWith("\n") ? `${toml}\n` : toml;
  return `${prefix}${marker}`;
}

function rememberPreviousDefault(toml: string): string {
  if (previousDefaultRegExp.test(toml)) return toml;
  const current: string | null = getSectionField(toml, MODELS_SECTION, "default");
  if (!current || current === GROK_MAIN_MODEL_SLOT) return toml;
  return insertMarker(toml, `# 9router-prev-default = ${tomlString(current)}\n`);
}

function restorePreviousDefault(toml: string): string {
  const previous: string = toml.match(previousDefaultRegExp)?.[1] || GROK_BUILTIN_DEFAULT;
  let next: string = toml.replace(previousDefaultRegExp, "");
  if (getSectionField(next, MODELS_SECTION, "default") === GROK_MAIN_MODEL_SLOT) {
    next = setSectionField(next, MODELS_SECTION, "default", previous);
  }
  return next;
}

function rememberPreviousSubagent(toml: string, type: string): string {
  const regexp: RegExp = previousSubagentRegExp(type);
  if (regexp.test(toml)) return toml;
  const current: string | null = getSectionField(toml, SUBAGENT_MODELS_SECTION, type);
  const previous: string = current == null ? UNSET_SENTINEL : current;
  return insertMarker(
    toml,
    `# 9router-prev-subagent-${type} = ${tomlString(previous)}\n`,
  );
}

function restorePreviousSubagent(toml: string, type: string): string {
  const regexp: RegExp = previousSubagentRegExp(type);
  const previous: string = toml.match(regexp)?.[1] || UNSET_SENTINEL;
  let next: string = toml.replace(regexp, "");
  if (getSectionField(next, SUBAGENT_MODELS_SECTION, type) !== modelSlot(type)) {
    return next;
  }
  if (previous === UNSET_SENTINEL) {
    return deleteSectionField(next, SUBAGENT_MODELS_SECTION, type);
  }
  return setSectionField(next, SUBAGENT_MODELS_SECTION, type, previous);
}

export function parseGrokBuildConfig(toml: string): GrokBuildConfig {
  const subagentModels: Record<string, ModelSection | null> = {};
  const subagentMappings: Record<string, string | null> = {};
  for (const type of GROK_SUBAGENT_TYPES) {
    const mapping: string | null = getSectionField(toml, SUBAGENT_MODELS_SECTION, type);
    subagentMappings[type] = mapping;
    subagentModels[type] = mapping === modelSlot(type)
      ? parseModelSection(toml, mapping)
      : null;
  }

  return {
    model: parseModelSection(toml, GROK_MAIN_MODEL_SLOT),
    default: getSectionField(toml, MODELS_SECTION, "default"),
    subagentModels,
    subagentMappings,
  };
}

/**
 * Apply main model and optional per-type subagent overrides while preserving all unrelated TOML.
 * `subagentModels === undefined` leaves existing subagent config untouched for API compatibility.
 */
export function applyGrokBuildConfig(
  toml: string,
  { baseUrl, apiKey, model, contextWindow, subagentModels }: ApplyGrokBuildConfigOptions,
): string {
  let next: string = rememberPreviousDefault(toml);
  next = upsertModelSection(next, {
    slot: GROK_MAIN_MODEL_SLOT,
    model,
    baseUrl,
    apiKey,
    contextWindow,
    name: "9Router",
  });
  next = setSectionField(next, MODELS_SECTION, "default", GROK_MAIN_MODEL_SLOT);

  if (subagentModels && typeof subagentModels === "object") {
    for (const type of GROK_SUBAGENT_TYPES) {
      const selected: SubagentModelOverride | null | undefined = subagentModels[type];
      const slot: string = modelSlot(type);
      if (selected?.model) {
        next = rememberPreviousSubagent(next, type);
        next = upsertModelSection(next, {
          slot,
          model: selected.model,
          baseUrl,
          apiKey,
          contextWindow: selected.contextWindow,
          name: `9Router ${type}`,
        });
        next = setSectionField(next, SUBAGENT_MODELS_SECTION, type, slot);
      } else {
        next = restorePreviousSubagent(next, type);
        next = removeModelSection(next, slot);
      }
    }
  }

  return next;
}

export function resetGrokBuildConfig(toml: string): string {
  let next: string = toml;
  for (const type of GROK_SUBAGENT_TYPES) {
    next = restorePreviousSubagent(next, type);
    next = removeModelSection(next, modelSlot(type));
  }
  next = removeModelSection(next, GROK_MAIN_MODEL_SLOT);
  next = restorePreviousDefault(next);
  return next.replace(/\n{3,}/g, "\n\n");
}

export function getGrokSubagentSlot(type: string): string | null {
  return GROK_SUBAGENT_TYPES.includes(type) ? modelSlot(type) : null;
}
