"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, CheckCircle2, AlertCircle, ClipboardPaste, Globe, Shield } from "lucide-react";
import { parseWebSessionCredential, type CredentialOrigin } from "../../utils/webSessionCredential";

interface ImportStepProps {
  providerName: string;
  website?: string;
  authHint?: string;
  onExtracted: (credential: string, origin: CredentialOrigin) => void;
}

const ORIGIN_LABELS: Record<CredentialOrigin, string> = {
  "curl-cookie": "Cookie header",
  "curl-authorization": "Authorization header",
  "header-authorization": "Authorization header",
  "header-cookie": "Cookie header",
  json: "JSON token",
  raw: "Raw value",
};

type Tab = "curl" | "manual";

export default function ImportStep({ providerName, website, authHint, onExtracted }: ImportStepProps) {
  const [activeTab, setActiveTab] = useState<Tab>("curl");
  const [curlInput, setCurlInput] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [extractedCredential, setExtractedCredential] = useState<string | null>(null);
  const [extractOrigin, setExtractOrigin] = useState<CredentialOrigin | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleExtractFromCurl = useCallback(() => {
    if (!curlInput.trim()) return;
    setParseError(null);
    setExtractedCredential(null);

    const result = parseWebSessionCredential(curlInput);
    if (result?.credential) {
      setExtractedCredential(result.credential);
      setExtractOrigin(result.origin);
    } else {
      setParseError("Could not extract a session credential from this input. Make sure you copied a cURL command from DevTools Network tab.");
    }
  }, [curlInput]);

  const handleUseManual = useCallback(() => {
    if (!manualInput.trim()) return;
    const result = parseWebSessionCredential(manualInput.trim());
    if (result?.credential) {
      setExtractedCredential(result.credential);
      setExtractOrigin(result.origin);
      setParseError(null);
    } else {
      setExtractedCredential(manualInput.trim());
      setExtractOrigin("raw");
      setParseError(null);
    }
  }, [manualInput]);

  const handleContinue = useCallback(() => {
    if (extractedCredential && extractOrigin) {
      onExtracted(extractedCredential, extractOrigin);
    }
  }, [extractedCredential, extractOrigin, onExtracted]);

  function maskCredential(value: string): string {
    if (value.length <= 12) return "••••••••";
    return `${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 8, 32))}${value.slice(-4)}`;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Honest notice */}
      <div className="flex gap-3 rounded-lg border border-border/60 bg-muted/30 p-3" role="note">
        <Shield className="size-4 shrink-0 text-text-muted mt-0.5" aria-hidden="true" />
        <p className="text-xs text-text-muted leading-relaxed">
          Browsers do not allow automatic cross-site cookie capture. You&apos;ll need to copy session data from your browser&apos;s DevTools manually. This is a one-time setup per connection.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-text-muted" aria-current="step">
        <span className="flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold" aria-hidden="true">1</span>
        <span className="font-medium">Get session from browser</span>
        <span className="text-border" aria-hidden="true">→</span>
        <span className="flex items-center justify-center size-5 rounded-full bg-muted text-text-muted text-[10px] font-semibold" aria-hidden="true">2</span>
        <span>Name &amp; save</span>
      </div>

      {/* Open provider site */}
      {website && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => window.open(website, "_blank", "noopener,noreferrer")}
            icon={<Globe className="size-4" />}
            iconRight={<ExternalLink className="size-3.5" />}
          >
            Open {providerName}
          </Button>
          <span className="text-xs text-text-muted">Sign in first, then come back here.</span>
        </div>
      )}

      {/* Auth hint */}
      {authHint && (
        <p className="text-xs text-text-muted">{authHint}</p>
      )}

      <Separator />

      {/* Tabs: Import vs Manual */}
      <div role="tablist" aria-label="Import method" className="flex gap-1 rounded-lg bg-muted p-0.5">
        <button
          type="button"
          role="tab"
          id="ws-tab-curl"
          aria-selected={activeTab === "curl"}
          aria-controls="ws-panel-curl"
          onClick={() => setActiveTab("curl")}
          className={`flex-1 rounded-md px-3 py-2.5 min-h-[44px] text-sm font-medium transition-all ${
            activeTab === "curl"
              ? "bg-background text-foreground shadow-sm"
              : "text-text-muted hover:text-foreground"
          }`}
        >
          Import Request
        </button>
        <button
          type="button"
          role="tab"
          id="ws-tab-manual"
          aria-selected={activeTab === "manual"}
          aria-controls="ws-panel-manual"
          onClick={() => setActiveTab("manual")}
          className={`flex-1 rounded-md px-3 py-2.5 min-h-[44px] text-sm font-medium transition-all ${
            activeTab === "manual"
              ? "bg-background text-foreground shadow-sm"
              : "text-text-muted hover:text-foreground"
          }`}
        >
          Manual Entry
        </button>
      </div>

      {/* Tab panels */}
      {activeTab === "curl" && (
        <div role="tabpanel" id="ws-panel-curl" aria-labelledby="ws-tab-curl" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-curl-input" className="text-sm font-medium text-text-main">
              Paste cURL command
            </Label>
            <ol className="text-xs text-text-muted flex flex-col gap-1 list-decimal list-inside">
              <li>Open DevTools → Network tab</li>
              <li>Do any action on {providerName} (send a message, click a button)</li>
              <li>Right-click the request → Copy → Copy as cURL</li>
              <li>Paste below</li>
            </ol>
            <Textarea
              id="ws-curl-input"
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder={`curl 'https://${website ? website.replace(/^https?:\/\//, "") : "example.com"}/api/...' \\\n  -H 'Cookie: session=abc123...' \\\n  -H 'User-Agent: ...'`}
              className="font-mono text-xs min-h-[120px] resize-none"
              aria-describedby="ws-curl-hint"
            />
            <p id="ws-curl-hint" className="text-xs text-text-muted">
              The session credential will be extracted automatically. Your input is processed locally.
            </p>
          </div>

          <Button
            onClick={handleExtractFromCurl}
            disabled={!curlInput.trim()}
            icon={<ClipboardPaste className="size-4" />}
            fullWidth
          >
            Extract Session
          </Button>
        </div>
      )}

      {activeTab === "manual" && (
        <div role="tabpanel" id="ws-panel-manual" aria-labelledby="ws-tab-manual" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-manual-input" className="text-sm font-medium text-text-main">
              Session credential
            </Label>
            <p className="text-xs text-text-muted">
              Paste the raw cookie string, token, or session value directly.
            </p>
            <Textarea
              id="ws-manual-input"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="eyJhbGciOi... or session_token=abc123; ..."
              className="font-mono text-xs min-h-[100px] resize-none"
            />
          </div>
          <Button
            onClick={handleUseManual}
            disabled={!manualInput.trim()}
            variant="secondary"
            fullWidth
          >
            Use This Value
          </Button>
        </div>
      )}

      {/* Parse error — live region */}
      {parseError && (
        <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertCircle className="size-4 shrink-0 text-destructive mt-0.5" aria-hidden="true" />
          <p className="text-xs text-destructive">{parseError}</p>
        </div>
      )}

      {/* Extracted credential confirmation — live region */}
      {extractedCredential && !parseError && (
        <div aria-live="polite" className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">Session extracted</span>
            {extractOrigin && (
              <Badge variant="outline" className="text-[10px]">
                {ORIGIN_LABELS[extractOrigin]}
              </Badge>
            )}
          </div>
          <code className="rounded bg-muted/50 px-2 py-1.5 text-xs font-mono text-text-muted truncate" aria-label="Masked credential">
            {maskCredential(extractedCredential)}
          </code>
          <Button onClick={handleContinue} fullWidth>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
