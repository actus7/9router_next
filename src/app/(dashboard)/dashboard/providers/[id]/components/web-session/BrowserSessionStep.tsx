"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWebSessionExtension } from "@/shared/hooks/useWebSessionExtension";
import { translate } from "@/i18n/runtime";
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
        <h3 className="font-semibold">{translate("Connect via browser") || "Connect via browser"}</h3>
        <p className="text-sm text-muted-foreground" role="status">
          {extension.busy ? translate("Confirm in the extension, log in to the site and, if needed, send a message. The session will be received here. If the window does not open, click the extension icon.") || "Confirm in the extension, log in to the site and, if needed, send a message. The session will be received here. If the window does not open, click the extension icon."
            : extension.state === "checking" ? translate("Checking extension…") || "Checking extension…"
              : extension.state === "ready" && supported ? translate("Open your account with the extension. You log in to the site and receive the session here, without copying commands.") || "Open your account with the extension. You log in to the site and receive the session here, without copying commands."
                : extension.state === "ready" ? translate("This provider still requires manual entry.") || "This provider still requires manual entry."
                  : translate("Install or authorize the extension in this ModelHub to connect your account through the browser.") || "Install or authorize the extension in this ModelHub to connect your account through the browser."}
        </p>
        {extension.state === "ready" && supported && <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={extension.busy} onClick={() => extension.connect(props.provider, (credential) => props.onExtracted(credential, "extension"))}><Globe data-icon="inline-start" />{translate("Connect") || "Connect"} {props.providerName}</Button>
          {extension.busy && <Button variant="outline" onClick={extension.cancel}>{translate("Cancel") || "Cancel"}</Button>}
        </div>}
        {extension.state !== "ready" && <div className="flex flex-wrap items-center gap-3">
          <Link href="/dashboard/web-providers" className="text-sm text-primary underline underline-offset-4">{translate("See installation instructions") || "See installation instructions"}</Link>
          <Button variant="outline" disabled={extension.state === "checking"} onClick={extension.detect}>{translate("Check again") || "Check again"}</Button>
        </div>}
        {extension.error && <p role="alert" className="text-sm text-destructive">{extension.error}</p>}
      </div>
      <Button variant="ghost" disabled={extension.busy} onClick={() => setManual(!manual)} aria-expanded={manual} aria-controls="manual-web-session" className="self-start">{manual ? translate("Hide manual entry") || "Hide manual entry" : translate("Advanced options: manual entry") || "Advanced options: manual entry"}</Button>
      {manual && <div id="manual-web-session"><ImportStep {...props} /></div>}
    </div>
  );
}
