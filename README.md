# ModelHub

Gateway compatível com OpenAI (chat, Responses, embeddings), Anthropic, Gemini e SSE, mais um dashboard para
conectar providers, normalizar modelos, montar combos e roteamento inteligente, acompanhar uso e cotas.
Multi-tenant por organização; a identidade é o Neon Auth.

## Requisitos

- Node `>=22.18.0` e npm `>=11`
- Um banco Neon Postgres e um projeto Neon Auth

## Desenvolvimento

```bash
cp .env.example .env
```

Preencha no `.env` as três variáveis obrigatórias (veja `.env.example` para o formato):

- `DATABASE_URL` — Neon Postgres
- `NEON_AUTH_BASE_URL`
- `NEON_AUTH_COOKIE_SECRET` — pelo menos 32 caracteres

Opcionais relevantes: `CREDENTIAL_KEY` (cifra as credenciais; ver `docs/OPERATIONS.md`) e
`ALLOW_PRIVATE_PROVIDER_ENDPOINTS`.

```bash
npm ci
npm run dev        # http://localhost:3000
```

## Produção e Docker

```bash
npm run build
npm start          # porta 20128
```

O `Dockerfile` e o `docker-compose.yml` da raiz também expõem a porta 20128.

## Qualidade

- `npm test` — testes (Vitest)
- `npm run check` — gate completo (lint, contract, build, typecheck, cobertura, rotas estáticas, whitespace); deve sair verde antes de dar algo por pronto

## Documentação

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — fronteiras e decisões
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — convenções do projeto
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — publicação
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — operação
- [`docs/KNOWN_DEBT.md`](docs/KNOWN_DEBT.md) — dívidas conhecidas
