# ModelHub Web Sessions

Extensão Manifest V3 para Chrome/Edge desktop 127+. Distribuição local, sem loja.

1. Baixe o ZIP em ModelHub → Web Session Providers e extraia em uma pasta permanente.
2. Abra `chrome://extensions` ou `edge://extensions`, ative Modo do desenvolvedor e escolha Carregar sem compactação. Selecione a pasta que contém `manifest.json`.
3. Abra o dashboard autenticado. No menu de extensões, abra ModelHub Web Sessions e clique em Autorizar este ModelHub.
4. Volte ao dashboard e clique em Verificar extensão. Abra um provider e escolha Conectar pelo navegador.
5. Confirme o destino e autorize o site no popup da extensão. Faça login normalmente. No Z.ai, envie uma mensagem para gerar a verificação.
6. Volte ao ModelHub para nomear, validar e salvar a sessão. Captura não significa que o gateway conseguiu executar um modelo; teste o modelo após salvar.

Para atualizar, substitua os arquivos da pasta e use Recarregar na página de extensões. Recarregue também as abas do ModelHub. Remova autorizações pelo popup ou desinstale pela página de extensões.

## Suporte inicial

Z.ai (Authorization + captcha_verify_param na mesma requisição), Kimi (access_token no localStorage), Blackbox, Conol, Poe, Inner AI, T3, Yuanbao e ZenMux (cookies especificados por adaptador). Outros providers seguem com entrada manual. Os adaptadores refletem o contrato do gateway; alterações nos sites podem exigir atualização. CAPTCHA/MFA continuam interativos, e não há renovação contínua em segundo plano.

## Dados e permissões

Nenhuma captura ocorre só por instalar ou autorizar a extensão. Cada conexão exige confirmação no popup. Permissões de site são solicitadas por provider; cookies são opcionais e só solicitados quando necessários. Os padrões de permissão do Chrome não isolam portas, mas a autorização interna valida a origem completa, incluindo a porta.

A sessão é entregue apenas ao documento e à aba do ModelHub que solicitaram a conexão, com identificador aleatório e prazo de três minutos. Cookies de outros sites, senha, histórico e conteúdo das conversas não são enviados. No Z.ai o corpo da requisição é analisado temporariamente para extrair apenas o parâmetro de verificação. Credenciais não são gravadas em disco, logs, URLs ou storage.sync pela extensão; o ModelHub recebe a sessão para validar/salvar com seu fluxo autenticado existente. As origens autorizadas ficam em storage.local; o trabalho pendente, sem credenciais, em storage.session.

## Desenvolvimento

Fontes: `packages/modelhub-web-sessions`. Gere o download com `npm run extension:build`; o prebuild também gera o ZIP. O pacote usa uma lista explícita de arquivos e saída determinística. Após editar, recarregue a extensão e as abas.
