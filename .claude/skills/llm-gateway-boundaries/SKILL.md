---
name: llm-gateway-boundaries
description: >-
  Fronteiras do LLM gateway do ModelHub. Use ao editar src/app/api/**,
  src/server/llm-gateway/**, src/shared/llm-catalog/** ou src/lib/db/**.
---

# Fronteiras do LLM gateway

- `src/app/api` só adapta HTTP: valida input, delega ao domínio, serializa o
  contrato público. Não deve conter lógica de protocolo/fallback/seleção de conta.
- `src/server/llm-gateway` é dono de protocolo, seleção de conta, execução de
  provider e fallback. O `engine/` é isolado do Next.js e de detalhes de storage
  local via `engine/host`.
- `src/shared/llm-catalog` é a projeção tipada e client-safe do registro do
  servidor. `src/shared/constants/providers.ts` é a projeção para o dashboard;
  código de UI deve usar os seletores dali, não recodificar regras de
  categoria/autenticação.
- `src/lib/db` é dono de persistência e migrações. `modelAvailability` normaliza
  disponibilidade de provider; `providerConnections.testStatus` significa
  apenas resultado de teste de conexão, nada além disso.
- Falhas por modelo (402/429/502/503 e erros específicos de modelo) criam um
  registro de disponibilidade com motivo, erro sanitizado e expiração — nunca
  marcam a conexão inteira como indisponível.

Antes de considerar pronto qualquer mudança que toque esses diretórios, rodar:

```
npm run test -- architectureGates dashboardGuard
```

Ver `docs/ARCHITECTURE.md` para o texto completo das fronteiras.
