# Dívida técnica conhecida

Itens intencionalmente adiados das fatias de refatoração. Rastrear aqui antes de abordar em trabalho dedicado.

A auditoria do core do gateway está concluída e não deixou dívida aberta: endpoint operacional, gerenciamento de modelos e os fluxos de validação e teste de provider. O registro dos trinta achados, das correções e das três decisões de comportamento está em [AUDITORIA-CORE.md](AUDITORIA-CORE.md).

## `package-lock.json` insatisfazível — resolvido

Ficava registrado aqui que o lock não tinha entrada resolvendo
`@emnapi/core@^1.11.1` nem `@emnapi/runtime@^1.11.1`, ambos declarados por
`@tailwindcss/oxide-wasm32-wasi` e `@img/sharp-wasm32`. O lock estava
insatisfazível como escrito, e foi o que deixou o job `check` vermelho em todo
PR — inclusive no #1.

Por que passou despercebido: o npm no Windows nunca instala esses pacotes de
plataforma, então nunca valida a subárvore deles e reporta o lock como
`up to date`. O `npm ci` no Linux valida a árvore inteira e recusa com
`Missing: @emnapi/runtime@1.11.3 from lock file`.

Resolvido acrescentando as duas entradas ao lock com metadados do registry
(versão, `resolved`, `integrity` e dependências), hoisted para o topo porque não
havia conflito naquela posição: `@emnapi/wasi-threads@1.2.3` já estava lá e
satisfaz a exigência exata do `core`, e `tslib@2.8.1` satisfaz `^2.4.0`. O CI
voltou para `npm ci`, então nenhuma build pode resolver uma versão que o lock não
registra.

Regenerar o lock no Linux continua sendo a forma mais robusta de evitar a classe
inteira desse problema — o npm só resolve a subárvore da plataforma onde roda, e
`--os=linux --cpu=x64 --force` do Windows não acrescenta as variantes.

## Riscos de segurança (fora de escopo desta revisão)

1. ~~**Credenciais em plaintext no SQLite**~~ — **resolvido, com uma ressalva.** `apiKey`, `accessToken`, `refreshToken` e `idToken` dentro de `providerConnections.data` agora são cifrados com AES-256-GCM por campo (`src/lib/db/helpers/credentialCipher.ts`), chave derivada de `CREDENTIAL_KEY` com scrypt, linhas existentes migradas pela 010. O backup herda de graça, porque copia os bytes já cifrados. A propagação para fora do banco também fechou: cada destino recebe chave própria registrada em `apiKeys.sink`, e `usageHistory.apiKey` guarda o id da linha (migration 009) — rotação em `docs/OPERATIONS.md`.

   **A ressalva:** sem `CREDENTIAL_KEY` definida o app roda em claro, avisando a cada boot e expondo o estado em `GET /api/settings` (`credentialEncryptionEnabled`). Isso é deliberado — recusar o boot brickaria instalações que nunca optaram. Onde plaintext não é aceitável, `CREDENTIAL_ENCRYPTION_REQUIRED=true` faz o app recusar subir sem a chave; a política é configuração, não decisão de código. Ver `docs/OPERATIONS.md`.
2. ~~**Secrets padrão previsíveis**~~ — **reclassificado, não era risco.** Ver as duas seções abaixo.
3. ~~**CORS permissivo em `/v1`**~~ — **não é dívida: é escolha de produto registrada.** Auditoria de clientes concluída, decisão tomada — o gateway suporta aplicação web de terceiro apontando para ele, e é isso que o `*` habilita. Ver a seção abaixo.

## CORS permissivo — auditoria de clientes concluída

O item pedia a auditoria antes de qualquer mudança, porque apertar a allowlist
sem enumerar quem chama quebra cliente em campo, e o modo de falha do CORS é dos
piores de diagnosticar: o request simplesmente não chega, sem erro no servidor.

**O fato que decide quase tudo:** CORS só se aplica a request iniciado por
browser. Um cliente server-side (Node, Go, curl) não envia `Origin` e não impõe
CORS, então `Access-Control-Allow-Origin` é irrelevante para ele.

| Cliente | Tipo | Envia `Origin`? | Precisa de ACAO? |
|---|---|---|---|
| As 18 ferramentas de CLI (Claude Code, Codex, Cline…) | processo server-side | não | **não** |
| Containers na Render/Railway | server-side | não | **não** |
| Probes de túnel (cloudflared, worker do abc-tunnel) | server-side | não | **não** |
| `basic-chat` → `/api/v1/chat/completions` | browser, **mesma origem** (caminho relativo, `executeSendMessage.ts:345`) | sim | **não** — mesma origem não passa por CORS |
| Exemplos "try it" de media providers | browser, mesma origem | sim | **não** |
| `endpointPing.ts:10` e `useTunnel.ts:73` → `${tunnelUrl}/api/health` | browser, **cross-origin** | sim | **sim** |

Conclusão: **nenhum cliente deste repositório precisa de `*` nas rotas
`/v1/*`.** O único caso legítimo de browser cross-origin é o dashboard sondando
`/api/health` através do túnel, e uma allowlist com loopback +
`settings.tunnelUrl` + `settings.tailscaleUrl` cobre isso inteiramente.

### Decisão: manter o `*`

O `*` em `/v1/*` só serve a aplicações web de terceiros apontando para o gateway
do usuário. **Decidido que esse caso de uso é suportado** — é coerente com um
produto que se chama gateway, e apertar a allowlist o eliminaria.

Isso deixa de ser dívida técnica e passa a ser escolha registrada. Consequências
que vêm com ela, documentadas para não serem redescobertas como se fossem bug:

- Qualquer página web pode fazer request para o gateway a partir do browser de
  quem a visita. O que a protege **não é** o CORS: é o gate de API key
  (`requireGatewayApiKey`) e, para chamador remoto, o `dashboardGuard`. O CORS
  nunca foi a fronteira de segurança aqui.
- Como o navegador não anexa credencial de outra origem por padrão, o risco
  concreto é uma página de terceiro usar uma chave que o usuário lhe forneceu —
  o que é o caso de uso, não um ataque.
- Se algum dia isso for revisto, a mudança segura já está desenhada: sem
  `Origin`, não emitir ACAO (todo cliente server-side segue intacto); com
  `Origin`, refletir apenas loopback + `settings.tunnelUrl` +
  `settings.tailscaleUrl`. A tabela acima é o inventário que torna essa mudança
  possível sem quebrar cliente em campo.

## `API_KEY_SECRET` — reclassificado de risco para código morto (removido)

O registro dizia que o fallback `API_KEY_SECRET || "endpoint-proxy-api-key-secret"`
era um secret padrão previsível. A verificação mostrou que **não era explorável**:
o secret alimentava um único HMAC (`generateCrc`) usado só na *geração* da chave,
e nada nunca verificava esse CRC. A validação é
`SELECT isActive FROM apiKeys WHERE key = ?` — igualdade exata contra o banco, que
é a fronteira de confiança real. Com o secret conhecido dava para fabricar uma
chave bem-formada que não autenticava nada.

A correção certa era a oposta da registrada: **deletar o CRC**, não rotacionar o
secret. Feito — `src/shared/utils/apiKey.ts` agora usa bytes aleatórios no sufixo,
mesmo formato (`sk-{machineId}-{keyId}-{8}`), sem secret para vazar ou rotacionar.
Um digest com chave que nenhum leitor confere é complexidade que *parece*
segurança, o que é pior do que não ter.

## Senha padrão — residual local, por escolha

O registro tratava a senha `123456` (`src/lib/auth/dashboardSession.ts`) como
exposição. O acesso remoto **já está fechado**:
`use-cases/http/auth/login/route.ts:67` calcula
`mustChangePassword = !storedHash && !INITIAL_PASSWORD && !isLocalRequest(request)`
e devolve **403 sem emitir token de sessão**, com o raciocínio documentado no
próprio código — emitir um JWT com senha pública permitiria a um atacante remoto
dar `PATCH /api/settings` e desligar a autenticação.

O residual é: na máquina local, `123456` abre sessão. Para um app local-first
single-user isso é postura defensável, equivalente a um SQLite sem senha no
diretório do usuário. **Nenhuma ação pendente** — a entrada anterior descrevia um
risco que não existe, e uma dívida assim custa atenção em toda revisão.

## Custódia da chave de cifragem (detalhe do item 1)

A custódia é uma env var, `CREDENTIAL_KEY`. As alternativas foram consideradas e
recusadas: o keychain do SO adiciona dependência nativa e quebra Docker headless,
o que contradiz a cadeia de 4 drivers SQLite que existe justamente para não
depender de binário nativo; e derivar do `machineId` protege contra quase nada,
já que quem tem o arquivo do banco tipicamente tem a máquina — seria cifragem
que só *parece* cifragem, pior que nenhuma porque cria confiança que não
corresponde à proteção.

Só o subconjunto de segredos é cifrado, não o blob inteiro: `email`,
`testStatus`, `lastError` e `consecutiveUseCount` moram no mesmo JSON e são
escritos no caminho quente (o round-robin atualiza a cada request), então cifrar
o blob poria cripto dentro da seleção de conta.

Se a definição do produto virar compliance, o correto passa a ser fail-closed
(recusar o boot sem a chave), e aí o release precisa de nota de migração
destacada — é quebra intencional.

## Rotas de harness sem autorização — resolvido

Ficava registrado aqui que `/api/harness/sandbox/eval` executava o `source` recebido sem guarda de autorização, porque `assertRequestRuntime()` é opt-out de prerender e não autentica nada. Isso foi fechado: as 14 rotas do harness passam por `requireDashboardAccess()` (`src/server/application/http/requireDashboardAccess.ts`), que falha fechado se as settings não puderem ser lidas. `tests/unit/harnessRouteAuth.test.ts` protege a regressão em `sandbox/eval` e em `mcp/discover`.

## Modelo desabilitado volta a ser chamável se o banco falhar

`isModelDisabled` (`src/server/llm-gateway/application/modelResolution.ts:108`) faz `catch { return false }` de propósito, com o argumento de que uma falha de leitura não deve derrubar o roteamento. O efeito prático é que uma intermitência de banco torna modelos desabilitados chamáveis de novo, sem alarme.

**Decidido: preferência de UI.** O armazenamento é `kv` scope `disabledModels` — uma lista por alias de provider, sem escopo por chave de API, sem trilha de auditoria e sem data de vigência. Essa não é a forma de um controle de compliance; é a forma de uma preferência. O fail-open fica, e o silêncio saiu: `isModelDisabled` agora loga em `warn` com provider e modelo antes de devolver `false`. Um risco aceito tem que ser visível.

Se a definição do produto mudar para controle de custo ou compliance, o correto passa a ser fail-closed com um caminho de erro distinto — "controle indisponível" (503) não é "modelo desabilitado" (404), e o cliente precisa distinguir para saber se vale retentar.

## Validação de chave Deepgram sem probe dedicado

`validateProviderKey.ts` perdeu o `case "deepgram"` (que batia em `/v1/projects` com auth `Token`) e agora cai no caminho genérico `probeMediaProvider`, que usa o `sttConfig` do registry — ou seja, faz POST de um corpo JSON em `/v1/listen`, endpoint que espera áudio binário. Deve continuar distinguindo chave válida de inválida pelo 401 vs não-401, mas isso não foi verificado contra uma chave real e não há teste cobrindo. **Bloqueado por falta de credencial** — não dá para verificar sem uma chave Deepgram real, e um mock só confirmaria o mock. Registrado assim para não voltar a ser discutido a cada revisão.

## Estado de i18n global no módulo (risco de concorrência no SSR)

`src/i18n/runtime.ts` guarda `currentLocale` e `translationMap` em variáveis de módulo, e `RuntimeI18nProvider` as semeia durante o render. No cliente isso é correto (um documento, um locale). No servidor o módulo é compartilhado por processo: se dois requests com locales diferentes intercalarem seus renders (o que pode acontecer quando um filho suspende), o render retomado pode usar o locale do outro request.

Hoje o risco é baixo — a aplicação é local-first e single-tenant — mas a correção adequada é tornar a resolução de locale request-scoped no servidor (por exemplo `AsyncLocalStorage` ou `React.cache()` num módulo server-only) em vez de estado de módulo. Isso implica trocar a assinatura de `translate()` nos ~50 componentes que a importam diretamente, então foi adiado.

## Literais de tradução com BOM UTF-8

Os 34 arquivos em `public/i18n/literals/*.json` são gravados com BOM. `Response.json()` no browser tolera, `JSON.parse` no servidor não — o que já causou fallback silencioso para inglês e mismatch de hidratação. `src/i18n/server.ts` remove o BOM na leitura e `tests/unit/i18nLiteralFiles.test.ts` protege a regressão, mas o ideal é corrigir a ferramenta que gera esses arquivos para emitir UTF-8 sem BOM.

## Landing token migration

A landing ainda usa cores hex hard-coded (`#f97815`, `#181411`, etc.) em vez dos design tokens/CSS variables do dashboard. Paridade visual foi preservada durante o split para Server Component; migrar para tokens compartilhados é passagem de styling separada.

## Mass color rename

Renomeação em massa de hex e classes ad-hoc para o sistema de tema compartilhado (`primary`, `bg-bg`, etc.) não foi incluída. Abrange landing, componentes de marketing e cards antigos do dashboard; fazer como migração dedicada de design system para evitar regressões mistas.
