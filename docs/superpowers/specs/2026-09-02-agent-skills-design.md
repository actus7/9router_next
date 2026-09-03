# Agent Skills no Chat — Design

**Data:** 2026-09-02  
**Status:** Aprovado

## Objetivo

Integrar Agent Skills ao basic-chat: aba nas configurações, CRUD no banco, ativação global + por sessão, consumo pelo modelo via progressive disclosure (`description` no prompt + `load_skill`), e meta-skill `skill-creator` para o agente criar skills conversando.

## Formato

Padrão Anthropic Agent Skills: `SKILL.md` com frontmatter YAML (`name`, `description`) e corpo markdown. A skill não é executada — é texto injetado no contexto.

## Composição

- **Bundle** (read-only, git): skills em `bundleSkills.ts`. Podem ser desativadas, não removidas.
- **Patch** (SQLite `agentSkills`): skills do usuário e overrides de `enabled` sobre bundled.

Tabela vazia reproduz o bundle exatamente (mesmo precedente de `pluginRows`).

## Ativação

- **Global:** coluna `enabled` no banco.
- **Por sessão:** `session.skillOverrides: Record<string, boolean>` em `ChatSession`.

Resolução: skill entra no prompt só se `enabled` global **e** não desativada na sessão.

## Runtime

Plugins `tool-skills` e `tool-skill-authoring`:

- `load_skill(name)` — busca corpo via `GET /api/harness/skills?id=`
- `create_skill` / `update_skill` — `PUT /api/harness/skills`

System prompt inclui bloco `- id: description` quando `tool-skills` está ativo.

## Segurança

Import por URL usa `safePublicFetch` (HTTPS, SSRF guard). Rascunho devolvido sem gravar; skills importadas entram desativadas por padrão.

## Fora de escopo

Página `/dashboard/skills` (links externos) permanece separada.
