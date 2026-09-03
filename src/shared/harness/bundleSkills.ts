import type { AgentSkillDefinition } from "./agentSkills";

export const BUNDLE_SKILLS: readonly AgentSkillDefinition[] = [
  {
    id: "skill-creator",
    name: "skill-creator",
    description:
      "Guides creation and editing of Agent Skills in SKILL.md format. Use when the user wants to create, improve, or document a reusable skill.",
    body: `# Skill Creator

Use this skill when the user wants to create, refine, or document an Agent Skill for ModelHub Chat.

## When a skill is worth creating

- Repeatable workflow (deploy checklist, code review rubric, API integration steps)
- Domain expertise the model should follow consistently
- Multi-step procedure with clear success criteria

Skip one-off answers, trivial tasks, or content that belongs in a single system prompt.

## SKILL.md format

\`\`\`markdown
---
name: my-skill-id
description: One line the model sees before loading the body (~30 tokens).
---

# Title

Instructions, examples, and constraints for the model.
\`\`\`

Rules:
- \`name\`: lowercase kebab-case slug, 2–64 chars, \`^[a-z0-9][a-z0-9-]{1,63}$\`
- \`description\`: max 1024 chars; say **when** to use the skill
- Body: markdown, max 64 KB

## Creating a skill in chat

When \`create_skill\` is available, call it with \`name\`, \`description\`, and \`body\` (full markdown including frontmatter is optional — plain body is fine).

When \`update_skill\` is available, pass only fields to change.

After creating a skill, tell the user it appears under Configurações → Skills and is enabled for this session once they toggle it on globally if needed.

## Progressive disclosure

The model only sees skill **descriptions** in the system prompt. Call \`load_skill(name)\` before following a skill's instructions.
`,
    enabled: true,
    origin: "bundle",
    bundled: true,
  },
];

export const BUNDLE_SKILL_IDS = new Set(BUNDLE_SKILLS.map((skill) => skill.id));
