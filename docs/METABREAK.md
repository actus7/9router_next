# MetaBreak no Token Saver

O controle em `/dashboard/token-saver` ativa um perfil fixo de comportamento no
gateway. Não há editor de prompt. A versão 2 adapta as diretrizes de entrega,
voz, qualidade e disciplina de agentes do `prompt.md` fornecido pelo usuário.
O texto está em `src/server/llm-gateway/engine/config/metabreak.ts`, empacotado
com o sistema; o arquivo `prompt.md` não é lido durante as requisições.

O perfil orienta o modelo a executar os pedidos, entregar trabalho completo,
investigar falhas, usar ferramentas disponíveis, preservar alterações alheias e
verificar resultados. Mantém o idioma e o contrato de saída solicitados. Não
impõe os nomes ANON/dj, uma assinatura, tags de pensamento ou uma linguagem de
programação. Não incorpora instruções para produzir conteúdo sexual não
consensual, facilitar ações maliciosas ou substituir restrições do provedor.

Isso acrescenta contexto e tokens; não é uma técnica de compressão. A aplicação
do perfil não prova que o modelo produzirá determinada resposta. Não é uma
reprodução do ataque descrito no `MetaBreak.pdf`. A versão anterior, baseada
em cinco turnos artificiais do assistente, foi substituída por este perfil.

## Compatibilidade

- Chat Completions: acrescenta o perfil ao primeiro turno de sistema/desenvolvedor,
  ou cria um turno de sistema se necessário. Preserva o tipo `text` em blocos.
- Responses/Codex: acrescenta o perfil a `instructions`, preservando `input`,
  `previous_response_id`, ferramentas, raciocínio e contratos de saída.
- Claude: acrescenta o perfil a `system`, preservando blocos e metadados de cache.
  Não utiliza preenchimento antecipado nem uma lista restrita de modelos.
- Gemini, Gemini CLI, Vertex e Antigravity: acrescenta o perfil às instruções de
  sistema, respeitando as duas grafias e o envelope `request` quando presente.
- Ferramentas, imagens, raciocínio e saída estruturada não desativam o perfil.
- Formatos proprietários sem campo compatível, como o corpo nativo Kiro, são
  ignorados. Isso não equivale a suporte universal a todos os provedores.
- A reaplicação do mesmo perfil não o duplica.
- O cabeçalho de desativação dos Token Savers também desativa o MetaBreak.

O perfil é aplicado após os demais transformadores e antes da finalização do
cache Claude. O log registra `METABREAK` quando aplicado e o motivo quando
ignorado. As mensagens originais e as instruções de sistema são preservadas.

## Configuração e migração

`metaBreakEnabled` é um booleano, inicialmente `false`. A leitura aceita o antigo
`jailbreakEnabled`, mas o novo campo tem precedência quando ambos existem.
`jailbreakPrompt` e `metaBreakPrompt` não são usados nem retornados. Na próxima
gravação, as chaves antigas são removidas da configuração persistida.

O dashboard só confirma a alteração após uma resposta bem-sucedida da API.
Durante a gravação, o controle fica indisponível; em caso de falha, a seleção
anterior é mantida e uma mensagem orienta a tentar novamente.

## Referências

- Direção atual: `prompt.md`, adaptado nas características descritas acima.
- Referência da primeira versão: `MetaBreak.pdf`, revisão de junho de 2026.

Os testes `metabreak*.test.*` cobrem o preset, a integração com os Token Savers,
a migração e a interação do controle. Usam exemplos inofensivos e não medem a
eficácia do método em modelos externos.
