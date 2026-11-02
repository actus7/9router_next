# Plan 014: README real e PRODUCT.md sem jornadas que não existem mais

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- README.md PRODUCT.md`

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: docs
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
`README.md` é o texto intacto do `create-next-app` (abrir `localhost:3000`, editar `app/page.tsx`, fonte Geist).
Quem o segue cai num crash (`DATABASE_URL is not set`) ou na porta errada. `PRODUCT.md` — o contrato de produto
que agentes e revisores usam para julgar release — ainda descreve telas removidas: "configure CLI tools"
(removidas em 2026-10-31), jornada 3 inteira sobre aplicar config de CLI tool, "recover from an expired or
default password" (identidade é só Neon Auth; não há senha) e "persistent state requires a writable disk"
(estado vive em Neon Postgres).

## Current state (fatos para usar no texto)
- Produto: ModelHub — gateway compatível com OpenAI (chat/Responses/embeddings, Anthropic, Gemini, SSE) +
  dashboard para conectar providers, normalizar modelos, combos e roteamento inteligente, uso e cotas,
  multi-tenant por organização.
- Requisitos: Node `>=22.18.0`, npm `>=11` (`package.json` `engines`).
- Variáveis obrigatórias: `DATABASE_URL` (Neon Postgres), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`
  (≥ 32 caracteres). Modelo: `.env.example` (o arquivo existe na raiz; não copie valores dele para docs).
  Opcional relevante: `CREDENTIAL_KEY` (cifra credenciais; ver `docs/OPERATIONS.md`), `ALLOW_PRIVATE_PROVIDER_ENDPOINTS`.
- Comandos: `npm run dev` (Next dev, porta 3000), `npm run build` + `npm start` (porta **20128**),
  `npm run check` (gate completo antes de reportar pronto), `npm test`.
- Docker: `Dockerfile` e `docker-compose.yml` na raiz (porta 20128).
- Docs: `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/KNOWN_DEBT.md`.
- `PRODUCT.md` linhas a corrigir: `:3` (CLI tools + disco gravável), `:14` (senha padrão), `:16` (jornada 3
  CLI tools), `:30` ("Authenticated browser checks cover desktop/mobile, light/dark" — não há runner de browser
  no CI; descreva como verificação manual).

## Scope
**In scope**: `README.md`, `PRODUCT.md`.
**Out of scope**: `docs/*`, `AGENTS.md`/`CLAUDE.md`, `DESIGN.md`.

## Steps
### Step 1: README
Reescreva em pt-BR, ~30-50 linhas: o que é; requisitos; `cp .env.example .env` e as 3 variáveis obrigatórias;
`npm ci && npm run dev`; produção/Docker na porta 20128; `npm run check`; links para os docs acima.
**Verify**: `grep -c "create-next-app\|Geist\|app/page.tsx" README.md` → 0; `grep -c "20128" README.md` → ≥ 1.
### Step 2: PRODUCT.md
Mantenha a estrutura e o idioma do arquivo (inglês). Remova CLI tools e a jornada 3 (renumere), troque o
item de senha por "sign in through Neon Auth and land on the dashboard of the active organization", troque o
requisito de disco por Neon Postgres (`DATABASE_URL`), e torne a checagem de browser explícita como manual.
**Verify**: `grep -ci "cli tool\|default password\|writable disk" PRODUCT.md` → 0.
### Step 3: `git diff --check` → sem saída.

## Git workflow
Branch `advisor/014-readme-and-product-docs`; commit ex.: `docs: README real e PRODUCT.md sem telas removidas`.

## Done criteria
- [ ] verificações dos Steps 1–3; só `README.md` e `PRODUCT.md` modificados
- [ ] nenhum valor de `.env`/`.env.example` copiado para os docs

## STOP conditions
- Encontrar no código uma rota de CLI tools ou senha ainda ativa (`ls "src/app/(dashboard)/dashboard"`) — reporte.

## Maintenance notes
- Ao remover/criar uma jornada crítica, atualizar `PRODUCT.md` no mesmo PR.
