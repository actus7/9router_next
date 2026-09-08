"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWebSessionExtension } from "@/shared/hooks/useWebSessionExtension";
import type { CredentialOrigin } from "../../utils/webSessionCredential";
import ImportStep from "./ImportStep";

interface Props {
  provider: string;
  providerName: string;
  website?: string;
  authHint?: string;
  onExtracted: (credential: string, origin: CredentialOrigin) => void;
}

export default function BrowserSessionStep(props: Props) {
  const extension = useWebSessionExtension();
  const [manual, setManual] = useState(false);
  const supported = extension.providers.includes(props.provider);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">Conectar pelo navegador</h3>
        <p className="text-sm text-muted-foreground" role="status">
          {extension.busy ? "Confirme na extensão, faça login no site e, se necessário, envie uma mensagem. A sessão será recebida aqui. Se a janela não abrir, clique no ícone da extensão."
            : extension.state === "checking" ? "Verificando extensão…"
              : extension.state === "ready" && supported ? "Abra sua conta com a extensão. Você faz login no site e recebe a sessão aqui, sem copiar comandos."
                : extension.state === "ready" ? "Este provider ainda requer entrada manual."
                  : "Instale ou autorize a extensão neste ModelHub para conectar sua conta pelo navegador."}
        </p>
        {extension.state === "ready" && supported && <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={extension.busy} onClick={() => extension.connect(props.provider, (credential) => props.onExtracted(credential, "extension"))}><Globe data-icon="inline-start" />Conectar {props.providerName}</Button>
          {extension.busy && <Button variant="outline" onClick={extension.cancel}>Cancelar</Button>}
        </div>}
        {extension.state !== "ready" && <div className="flex flex-wrap items-center gap-3">
          <Link href="/dashboard/web-providers" className="text-sm text-primary underline underline-offset-4">Ver instruções de instalação</Link>
          <Button variant="outline" disabled={extension.state === "checking"} onClick={extension.detect}>Verificar novamente</Button>
        </div>}
        {extension.error && <p role="alert" className="text-sm text-destructive">{extension.error}</p>}
      </div>
      <Button variant="ghost" disabled={extension.busy} onClick={() => setManual(!manual)} aria-expanded={manual} aria-controls="manual-web-session" className="self-start">{manual ? "Ocultar entrada manual" : "Opções avançadas: entrada manual"}</Button>
      {manual && <div id="manual-web-session"><ImportStep {...props} /></div>}
    </div>
  );
}
