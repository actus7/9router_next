# Spike: Puter + Xiaomi MiMo no browser

## Objetivo

Validar um caminho de Web Session que não copie nem persista cookies, tokens ou Local Storage: o browser carrega o SDK oficial do Puter e o próprio Puter conduz o login e a chamada de chat para MiMo.

## Implementação

O experimento está em `src/app/(dashboard)/dashboard/basic-chat/puterBrowser.ts` e só aparece no Basic Chat quando a variável abaixo estiver ativa no ambiente do navegador:

```text
NEXT_PUBLIC_ENABLE_PUTER_SPIKE=true
```

Ele disponibiliza `Xiaomi MiMo V2.5 (Puter)` como `Puter (MiMo experimental)`. O histórico da conversa e o streaming ficam no cliente; a requisição não passa pelo gateway do ModelHub e não cria uma conexão em banco.

## Limites de segurança

- O SDK vem de `https://js.puter.com/v2/` apenas quando o modelo é usado.
- O login é iniciado pelo SDK oficial, sem opção de criar conta temporária automaticamente.
- Esta aplicação não lê cookies, Local Storage, DevTools, perfil de navegador nem qualquer token do Puter.
- Nenhuma credencial do Puter é enviada ao servidor ou gravada em banco, logs ou storage da aplicação.

## Critério de aceite manual

1. Inicie o ambiente com a flag ativa e abra Basic Chat.
2. Escolha `Puter (MiMo experimental)` e envie uma mensagem inofensiva, por exemplo `Reply only: OK`.
3. Conclua o login ou consentimento no diálogo oficial do Puter, se solicitado.
4. Considere a spike aprovada somente se o streaming retornar texto real de MiMo. Login aberto, SDK carregado ou conexão listada não comprovam resposta do modelo.

## Próxima decisão

Se a resposta real for estável, a evolução correta é manter o adapter browser-only, acrescentar telemetria sem conteúdo/segredos e testes de UI. Não transformar a sessão do Puter em token reutilizável no servidor.
