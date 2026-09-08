"use client";

import { useState } from "react";
import { CheckCircle2, Download, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useWebSessionExtension } from "@/shared/hooks/useWebSessionExtension";

export function ExtensionInstallGuide() {
  const extension = useWebSessionExtension();
  const [showInstructions, setShowInstructions] = useState(false);
  const ready = extension.state === "ready";
  const checking = extension.state === "checking";
  return (
    <section aria-label="Extensão ModelHub" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {ready && <CheckCircle2 className="size-5 text-success" aria-hidden="true" />}
            {ready ? "Extensão conectada" : "Conecte suas contas pelo navegador"}
          </h2>
          <p role="status" className="max-w-prose text-sm text-muted-foreground">
            {checking ? "Verificando a extensão neste navegador…" : ready
              ? `ModelHub Web Sessions ${extension.version}. Escolha um provider abaixo para conectar sua conta.`
              : extension.state === "incompatible" ? "Atualize a extensão para usar esta versão do ModelHub."
                : "Instale a extensão no Chrome ou Edge do computador para importar sessões sem copiar cURL."}
          </p>
        </div>
        <Button variant="outline" onClick={extension.detect} disabled={checking} className="min-h-11 self-start">
          <RefreshCw data-icon="inline-start" />Verificar extensão
        </Button>
      </div>
      {ready && <Button variant="link" className="self-start" onClick={() => setShowInstructions(!showInstructions)} aria-expanded={showInstructions} aria-controls="extension-instructions">{showInstructions ? "Ocultar instruções" : "Instalação e atualização"}</Button>}
      {(!ready || showInstructions) && (
        <div id="extension-instructions" className="flex flex-col gap-4">
          <ol className="grid list-decimal gap-x-8 gap-y-3 pl-5 text-sm leading-relaxed sm:grid-cols-2">
            <li><strong>Baixe e extraia o ZIP.</strong> Guarde a pasta em um local permanente no computador.</li>
            <li><strong>Abra a página de extensões.</strong> Digite <code>chrome://extensions</code> ou <code>edge://extensions</code> na barra de endereços.</li>
            <li><strong>Ative o Modo do desenvolvedor.</strong> Clique em “Carregar sem compactação” e selecione a pasta que contém <code>manifest.json</code>.</li>
            <li><strong>Autorize este ModelHub.</strong> Nesta aba, abra “ModelHub Web Sessions” no menu de extensões e clique em “Autorizar este ModelHub”. Depois, verifique a extensão aqui.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <a href="/extensions/modelhub-web-sessions.zip" download className={buttonVariants({ size: "lg" })}><Download data-icon="inline-start" />Baixar extensão</a>
            <p className="max-w-prose text-xs text-muted-foreground">Para atualizar, substitua os arquivos da pasta e clique em Recarregar na página de extensões. Em outros navegadores, use a entrada manual.</p>
          </div>
        </div>
      )}
    </section>
  );
}
