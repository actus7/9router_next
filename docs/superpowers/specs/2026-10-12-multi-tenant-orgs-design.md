# Equipes, papéis e limites de acesso (multi-tenant e multi-usuário)

**Data:** 2026-10-12 · **Status:** implementado

## Problema

Um usuário era um tenant: cada conta enxergava só as próprias linhas e não havia
como trabalhar em equipe. As chaves de API carregavam um perfil (habilidades e
skills injetadas), mas nada dizia o que uma chave **podia** pedir — qualquer
chave chamava qualquer modelo da conta.

## Convenção adotada

A mesma de OpenAI (Org → Project → chave restrita), Anthropic (Workspaces) e
LiteLLM (Org → Team → User → Key):

```
Organização (tenant: dados, providers, combos, uso)
 └─ Membro (pessoa + papel: owner | admin | member)
     └─ Chave de API (criada por um membro, age como ele)
```

Limites empilham em camadas — organização, membro, chave — e uma requisição só
passa quando **todas** permitem. A chave restringe o membro, nunca amplia.

## Decisões

**D1 — Tenant = organização; o espaço pessoal tem o id do usuário.** Toda linha
escrita antes de existirem equipes já pertence ao tenant certo, sem migração de
dados e sem deploy coordenado. "Transformar em equipe" (`/api/team/convert`)
cria a organização do Neon Auth com esse mesmo id, escrevendo direto em
`neon_auth.organization`/`member`, porque `organization/create` geraria um id
novo — um tenant vazio. A coluna continua chamada `userId`: renomeá-la quebraria
a versão no ar (Vercel e Docker usam o mesmo Neon) durante o deploy.

**D2 — Contexto do tenant é um objeto.** `TenantContext { tenantId, actorUserId,
role }` no `AsyncLocalStorage` (`src/lib/db/tenant.ts`). `currentTenantId()` não
mudou de assinatura. Quem reentra no escopo depois (stream, run durável,
`captureTenant`) captura o contexto inteiro: reentrar só com o id faria de um
membro o dono.

**D3 — Resolução do tenant.**
- Dashboard (`tenantRoute`, `withTenantPage`): `session.activeOrganizationId`,
  confirmado em `neon_auth.member` (cache de 10 s, mesma janela da revogação de
  chave). Sem org ativa, ou removido dela: espaço pessoal.
- Gateway (`gatewayRoute`): a chave dá o tenant; `apiKeys.ownerUserId` dá o
  membro. Chave cujo dono saiu da equipe responde 401. `ownerUserId` NULL é chave
  de antes das equipes: age como o dono.
- Jobs (`forEachTenant`): usuários **e** organizações (UNION, o pessoal
  convertido aparece uma vez).

**D4 — Dados da equipe × dados do membro.** Compartilhados: providers, combos,
settings, catálogo de plugins e skills, uso, memória do **agente**. Privados de
quem os criou (`ownerUserId`, filtro `MEMBER_ROWS` =
`userId = ? AND COALESCE(ownerUserId, userId) = ?`): conversas, eventos, runs,
índice de busca, memória do **usuário**, chaves de API (para o papel member).
Linha antiga sem dono é do dono do espaço pessoal — sem backfill. Upserts
recusam sobrescrever a linha de outro membro (`rejected` no sync).

**D5 — Papéis.** `tenantRoute(handler, { minRole })` exige `admin` por padrão,
**leitura inclusive** (revisão de 2026-10-13). A primeira versão abria leitura
para `member` e a revisão de segurança achou o que isso custava: o export do
banco devolvia as credenciais de todos os providers e a chave de todo membro,
`/api/providers` devolvia os cookies das sessões web em `providerSpecificData`,
e 36 GETs abertos tocavam campos sensíveis. Hoje cada rota que a tela de um
membro usa diz `{ minRole: "member" }` — chat/harness, as próprias chaves,
modelos, combos, status do túnel — e as três que devolvem registro inteiro a um
admin (`/api/providers`, `/api/settings`) devolvem a um membro só os campos que
o seletor de modelos e os toggles leem. Rota nova que esquece fica fechada, não
aberta. Telas de gestão passam por `withTenantPage(..., { minRole: "admin" })`
ou `<AdminOnly>` e mandam o membro para o chat; componentes de uma tela de
membro que são da organização (túnel, respostas aprendidas, motor de decisão)
leem `useWorkspace().canManage` e nem disparam a requisição. Uso, requisições,
logs e a fila de aprovação são só de admin: mostram prompts de todo mundo.

O `tenantRoute` também abre o escopo de política (`withAccessLayers`) com as
camadas de quem age, falhando fechado (503) se não conseguir lê-las — antes só o
gateway e o worker do chat abriam, e as rotas de memória e governança, que
perguntam `sessionHasPlugin`, aceitavam qualquer plugin. A política só filtra
execução (ferramentas, skills, modelos); nenhuma tela de gestão a consulta, então
um admin continua vendo e editando tudo.

**D6 — Política de acesso.** `accessPolicies(userId, subjectType, subjectId,
policy)` com `subjectType` = `org` | `member` | `key`. `policy` =
`{ models?, plugins?, skills? }`; campo ausente = sem restrição, lista vazia =
nada. Modelos aceitam o nome como o cliente envia, nome de combo e glob final
(`cx/*`). Um combo permitido libera os modelos que ele usa
(`runModelAuthorized`). A camada de membro vale só para o papel `member` — dono e
admin editam políticas, restringi-los por uma linha que eles reescrevem seria
cadeado com a chave pendurada.

**D7 — Falha fechada.** Política que não dá para ler: 503. Modelo fora da
política: 403 `model_not_allowed` (não o `insufficient_quota` genérico do 403).
Linha de política ilegível vira "nada liberado".

**D8 — Onde a política é aplicada.**
- Modelos: entrada de chat, embeddings, imagem, TTS, STT, vídeo e busca
  (`assertModelAllowed`); `/v1/models` lista só o permitido; o seletor do chat
  esconde o resto e diz por quê quando não sobra nada.
- Plugins (só os de ferramenta, os únicos com capacidade): o worker remove a
  ferramenta do corpo da run (`withoutForbiddenPluginTools`),
  `sessionHasPlugin` recusa; o chat não lista.
- Skills: `load_skill` recusa; a chave só injeta o que a política deixa; o chat
  não lista.

## Uso por membro e limites (F8)

Cada linha de `usageHistory` grava `actorUserId` — o dono da chave na API, quem
mandou o turno no chat; linhas anteriores contam como do owner (`COALESCE` com
o tenant). A tela de Uso ganhou "Uso por membro", lida de `usageHistory` com
`GROUP BY` (não do agregado diário), então todo período responde igual.

A política de cada camada pode ter `limits: { rpm, monthlyBudgetUsd }`, contados
**contra o próprio sujeito**: o da organização contra o gasto de todos, o do
membro contra o que ele gastou com qualquer chave, o da chave contra ela. O
gateway (`gatewayRoute`) e o início de uma run do chat checam antes de chamar
qualquer provider (`usageLimits.ts`) e respondem 429 com `rate_limit_exceeded`
ou `budget_exceeded` e `Retry-After` (o fim do minuto ou do mês UTC). O
orçamento é checado antes do rpm, para um pedido recusado não gastar vaga. O
limite do membro só vale para quem tem papel `member`, como o resto da camada.
O gasto do mês fica em cache por 60 s: um orçamento pode estourar pelo que um
minuto de tráfego custa.

## Rotas que agem na máquina

Com cadastro aberto, todo usuário é owner do próprio espaço — `admin` não
distingue o operador da instalação. O que age na máquina e não em dados do
tenant fica só-local (`LOCAL_ONLY_PATHS`): túnel, MCP stdio, headroom e, desde
esta revisão, `/api/cli-tools/` inteiro, que lê e grava os arquivos de config
dos CLIs (com as chaves deles). O teste de proxy só aceita um proxy em endereço
privado quando o pedido vem da própria máquina.

## Cache local do chat

O chat guardava conversas, projetos e rascunhos em chaves globais do
`localStorage`. No mesmo navegador, a próxima conta via as conversas da anterior,
e o sync as enviava como dela. Hoje o cache é por `<tenant>:<membro>`; a cópia
global antiga não é importada (não se sabe de quem era) — só apagada. O servidor
devolve cada conversa ao dono.

## Convites e e-mail

Sem provedor de e-mail próprio, o convite não é enviado: a tela mostra o link e
o convite aparece na página Equipe quando a pessoa entra com aquele e-mail. O
Neon Auth só mostra e aceita convites para e-mail **verificado**; a página
oferece a verificação por código ali mesmo.

## Onde mora cada coisa

| O quê | Onde |
|---|---|
| Contexto, `MEMBER_ROWS`, papéis | `src/lib/db/tenant.ts` |
| Membership, conversão em equipe | `src/lib/auth/organizations.ts` |
| Política (puro) | `src/shared/access/accessPolicy.ts` |
| Política (repo e camadas) | `src/lib/db/repos/accessPoliciesRepo.ts` |
| Escopo no gateway | `src/server/llm-gateway/application/accessScope.ts` |
| Limites de uso | `src/server/application/http/usageLimits.ts`, `usageSpendRepo.ts` |
| Uso por membro | `src/lib/db/repos/usageByMemberRepo.ts` |
| API | `/api/access`, `/api/team/convert` |
| Telas | `/dashboard/team`, botão Acesso no Endpoint, `WorkspaceSwitcher` |

## Limites conhecidos

- Cache de política (15 s) e de membership (10 s) por processo: apertar um
  limite ou remover alguém leva até isso para valer em outra instância.
- O fallback grátis e o roteamento interno de um combo são decisão da equipe,
  não do pedido: não passam pela política de novo.
- Plugins de contexto/modo não são bloqueados no servidor (só acrescentam texto
  ao prompt).
- O rpm dos limites é contado por processo, como o limitador da conta: com
  várias instâncias o teto real é `rpm × instâncias`. O orçamento lê o gasto com
  cache de 60 s por instância.
- Um upstream que responde JSON a um pedido sem `stream` vai ao handler sem
  streaming (`servesJson`) para ser contado; esse caminho não tem o orçamento de
  primeiro byte do combo, como já não tinha um pedido com `stream: false`.
- Exclusão de conta ou de equipe continua sem apagar linhas
  (`docs/NEON-MIGRATION.md`).
