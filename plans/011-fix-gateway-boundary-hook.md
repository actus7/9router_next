# Plan 011: O hook de fronteira do gateway roda de verdade quando um arquivo do gateway é editado

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- .claude/settings.json .claude/hooks/`

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: dx
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
`docs/CONVENTIONS.md` afirma: "Para mudanças em `server/llm-gateway`, `shared/llm-catalog` ou `app/api`, isso
já roda automaticamente via o hook em `.claude/settings.json`". Não roda. O hook PostToolUse chama
`node .claude/hooks/check-gateway-boundaries.js "$FILE_PATH"`, mas o Claude Code entrega o input do hook como
**JSON no stdin** (`{"tool_name": ..., "tool_input": {"file_path": ...}}`), não numa variável `FILE_PATH`; o
caminho chega vazio e o script não faz nada. Se casasse, quebraria: o arquivo é `.js` num pacote
`"type": "module"` e usa `require` (ReferenceError). E `execFileSync('npm', ...)` sem shell falha com ENOENT no
Windows (`npm.cmd`), a plataforma primária de dev.

## Current state
- `.claude/hooks/check-gateway-boundaries.js` (inteiro):
  ```js
  // Roda os testes de fronteira arquitetural quando um arquivo do LLM gateway é editado.
  // Chamado pelo hook PostToolUse em .claude/settings.json.
  const rawPath = process.argv[2] || process.env.FILE_PATH || '';
  const normalized = rawPath.replace(/\\/g, '/');
  const boundaryPattern = /\/(server\/llm-gateway|shared\/llm-catalog|app\/api)\//;
  if (boundaryPattern.test(normalized)) {
    const { execFileSync } = require('child_process');
    try { execFileSync('npm', ['run', 'test', '--', 'architectureGates', 'dashboardGuard'], { stdio: 'inherit' }); }
    catch { process.exit(1); }
  }
  ```
- `.claude/settings.json:22-26`:
  ```json
  { "type": "command",
    "command": "node .claude/hooks/check-gateway-boundaries.js \"$FILE_PATH\"",
    "description": "Roda testes de fronteira arquitetural quando o LLM gateway é tocado" }
  ```
  Leia o arquivo inteiro para ver o `matcher` do PostToolUse.
- `package.json:3` `"type": "module"`.
- Hooks PostToolUse: exit code 2 faz o Claude Code mostrar o stderr ao modelo; exit 1 é erro não bloqueante.

## Scope
**In scope**: `.claude/hooks/check-gateway-boundaries.js` → renomear para `.claude/hooks/check-gateway-boundaries.mjs`,
`.claude/settings.json` (só o `command` dessa entrada).
**Out of scope**: o resto do `settings.json`; os testes `architectureGates`/`dashboardGuard`; `docs/CONVENTIONS.md`.

## Steps
### Step 1: reescrever o script como ESM lendo stdin
`git mv .claude/hooks/check-gateway-boundaries.js .claude/hooks/check-gateway-boundaries.mjs` e conteúdo:
```js
// Roda os testes de fronteira arquitetural quando um arquivo do LLM gateway é editado.
// Chamado pelo hook PostToolUse em .claude/settings.json; o Claude Code manda o input como JSON no stdin.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function editedPath() {
  if (process.argv[2]) return process.argv[2];
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    return input?.tool_input?.file_path || input?.tool_input?.path || "";
  } catch { return ""; }
}

const normalized = editedPath().replace(/\\/g, "/");
if (/\/(server\/llm-gateway|shared\/llm-catalog|app\/api)\//.test(normalized)) {
  try {
    execFileSync("npm", ["run", "test", "--", "architectureGates", "dashboardGuard"], { stdio: ["ignore", "inherit", "inherit"], shell: true });
  } catch {
    console.error("Testes de fronteira falharam (architectureGates/dashboardGuard). Ver saída acima.");
    process.exit(2);
  }
}
```
### Step 2: `settings.json`
`"command": "node .claude/hooks/check-gateway-boundaries.mjs"` (sem argumento).
**Verify**: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"` → sem erro.

### Step 3: provar que funciona
(Requer `npm ci` antes.)
- `echo '{"tool_input":{"file_path":"E:/x/src/server/llm-gateway/a.ts"}}' | node .claude/hooks/check-gateway-boundaries.mjs; echo "exit=$?"`
  → roda os testes (aparece saída do vitest) e `exit=0`.
- `echo '{"tool_input":{"file_path":"E:/x/src/components/a.tsx"}}' | node .claude/hooks/check-gateway-boundaries.mjs; echo "exit=$?"`
  → nenhuma saída, `exit=0`.
- `echo 'not json' | node .claude/hooks/check-gateway-boundaries.mjs; echo "exit=$?"` → `exit=0`.

## Git workflow
Branch `advisor/011-fix-gateway-boundary-hook`; commit ex.: `fix(dx): hook de fronteira do gateway lê o stdin e roda no Windows`.

## Done criteria
- [ ] `test -f .claude/hooks/check-gateway-boundaries.mjs && test ! -f .claude/hooks/check-gateway-boundaries.js`
- [ ] `grep -c "FILE_PATH" .claude/settings.json` → 0
- [ ] os três comandos do Step 3 dão o resultado esperado
- [ ] `git status` só mostra os dois arquivos

## STOP conditions
- `npm run test -- architectureGates dashboardGuard` falha por si só no worktree (problema pré-existente) — reporte a saída.
- O `matcher` do PostToolUse em `settings.json` não cobre `Edit|Write` — reporte (não amplie sem instrução).

## Maintenance notes
- Os testes levam alguns segundos; o hook roda a cada edição de arquivo do gateway. Se pesar, troque por
  `vitest related <arquivo>`.
