# router-demo

Chat nativo (janela, não navegador) para testar um gateway 9router de fora da
aplicação — o mesmo caminho que um cliente real usa: `Authorization: Bearer
<api key>` contra `/v1/models` e `/v1/chat/completions`, com streaming SSE.

Serve para responder "o gateway está de pé, a chave funciona e quão rápido ele
responde?" sem abrir o dashboard, e para ver o erro cru quando algo falha.

## Usar

```bash
cd demo
cargo run --release
```

1. **URL do gateway** — `http://localhost:3000` ou `9router-new.vercel.app`.
   Aceita sem esquema, com `/` no fim e com `/v1` no fim.
2. **API key** — criada no dashboard em **Chaves de API**.
3. **Conectar** — lista os modelos que a chave enxerga.
4. Escolha o modelo (o seletor tem filtro) e converse.
   Enter envia, Shift+Enter quebra linha, **Parar** interrompe.

Cada resposta mostra o tempo até o primeiro token, o tempo total e — quando o
gateway reporta uso — tokens de entrada/saída e tokens por segundo.

## O que fica salvo

| O quê | Onde |
|-------|------|
| URL e modelo | `%APPDATA%\router-demo\data\app.ron` |
| API key | Windows Credential Manager, entrada `router-demo` |

A key só é guardada depois que o gateway a aceita, e nunca vai para o arquivo
em texto. Com URL e key salvas, a janela já abre conectada. Para esquecer a key:
**Gerenciador de Credenciais → Credenciais do Windows → `router-demo`**.

A conversa não é salva — cada execução começa limpa.

## Desempenho

Medido nesta máquina (Windows 11, build release):

| | |
|---|---|
| Janela visível após iniciar | ~540 ms |
| CPU com a janela parada | ~0,5% de um núcleo |
| Memória (working set) | ~105 MB |
| Binário | 8 MB, sem dependências para instalar |

- Rede sempre fora da thread da janela; a UI nunca espera o gateway.
- A janela só redesenha quando algo muda (tecla, mouse, token chegando).
- Renderização por OpenGL (`glow`), sem webview.
- Release com LTO e `codegen-units = 1`.

## Pré-requisito no Windows

Rust precisa de um linker C, que o Windows não traz. Nesta máquina foi
instalado o mingw-w64 do WinLibs e o toolchain GNU, fixado só para esta pasta:

```powershell
winget install BrechtSanders.WinLibs.POSIX.UCRT
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup override set stable-x86_64-pc-windows-gnu   # dentro de demo/
```

O `override` fica nas configurações locais do rustup, não no repositório. Em
outra máquina com o Visual Studio Build Tools, `cargo run --release` funciona
direto, sem nada disso.

## Testes

```bash
cargo test
```

Cobrem o parsing do stream SSE, a normalização da URL, o resumo das medidas e
qual parte da conversa volta para o modelo depois de uma falha.
