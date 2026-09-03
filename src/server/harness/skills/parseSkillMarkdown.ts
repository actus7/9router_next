export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_BODY_LENGTH = 64 * 1024;
export const SKILL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export interface ParsedSkillMarkdown {
  name: string;
  description: string;
  body: string;
}

export interface SkillValidationError {
  field: string;
  message: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseSimpleYaml(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]!] = value;
  }
  return result;
}

export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const trimmed = raw.trim();
  const match = trimmed.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("SKILL.md must start with YAML frontmatter (--- ... ---)");
  }
  const fields = parseSimpleYaml(match[1]!);
  const name = fields.name?.trim();
  const description = fields.description?.trim();
  if (!name) throw new Error("frontmatter missing required field: name");
  if (!description) throw new Error("frontmatter missing required field: description");
  return {
    name,
    description,
    body: match[2]!.trim(),
  };
}

export function serializeSkillMarkdown(skill: ParsedSkillMarkdown): string {
  const description =
    skill.description.includes("\n") || skill.description.includes(":")
      ? `"${skill.description.replace(/"/g, '\\"')}"`
      : skill.description;
  return `---\nname: ${skill.name}\ndescription: ${description}\n---\n\n${skill.body.trim()}\n`;
}

export function validateSkillFields(fields: {
  id: string;
  name?: string;
  description: string;
  body: string;
}): SkillValidationError[] {
  const errors: SkillValidationError[] = [];
  if (!SKILL_SLUG_PATTERN.test(fields.id)) {
    errors.push({
      field: "id",
      message: "id must be lowercase kebab-case (2–64 chars)",
    });
  }
  if (fields.name !== undefined && fields.name !== fields.id) {
    errors.push({ field: "name", message: "name must match id slug" });
  }
  if (!fields.description.trim()) {
    errors.push({ field: "description", message: "description is required" });
  } else if (fields.description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    errors.push({
      field: "description",
      message: `description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters`,
    });
  }
  if (!fields.body.trim()) {
    errors.push({ field: "body", message: "body is required" });
  } else if (fields.body.length > MAX_SKILL_BODY_LENGTH) {
    errors.push({
      field: "body",
      message: `body exceeds ${MAX_SKILL_BODY_LENGTH} bytes`,
    });
  }
  return errors;
}

export function normalizeSkillId(raw: string): string {
  return raw.trim().toLowerCase();
}
