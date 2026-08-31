"use client";

import { Button, Input } from "@/shared/components";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";
import type { StatusMessage } from "../types";

interface OidcPanelProps {
  oidcForm: { oidcIssuerUrl: string; oidcClientId: string; oidcScopes: string; oidcLoginLabel: string };
  oidcClientSecret: string;
  setOidcClientSecret: React.Dispatch<React.SetStateAction<string>>;
  oidcStatus: StatusMessage;
  oidcLoading: boolean;
  oidcTestLoading: boolean;
  oidcTestStatus: StatusMessage;
  updateOidcForm: (field: string, value: string) => void;
  saveOidcSettings: (authMode?: string) => Promise<void>;
  testOidcConnection: () => Promise<void>;
  oidcRedirectUri: string;
  loading: boolean;
}

export default function OidcPanel({
  oidcForm, oidcClientSecret, setOidcClientSecret,
  oidcStatus, oidcLoading, oidcTestLoading, oidcTestStatus,
  updateOidcForm, saveOidcSettings, testOidcConnection, oidcRedirectUri,
  loading,
}: OidcPanelProps) {
  return (
    <div className="flex flex-col gap-4 pt-2 border-t border-border/50">
      <div className="grid grid-cols-1 gap-4">
        <div className="flex flex-col gap-2">
          <Label className="sm:text-base">{translate("Issuer URL")}</Label>
          <Input
            placeholder="https://auth.example.com/application/o/modelhub/"
            value={oidcForm.oidcIssuerUrl}
            onChange={(e) => updateOidcForm("oidcIssuerUrl", e.target.value)}
            disabled={loading || oidcLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="sm:text-base">{translate("Client ID")}</Label>
          <Input
            placeholder="modelhub-dashboard"
            value={oidcForm.oidcClientId}
            onChange={(e) => updateOidcForm("oidcClientId", e.target.value)}
            disabled={loading || oidcLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="sm:text-base">{translate("Client Secret")}</Label>
          <Input
            type="password"
            placeholder={translate("Leave blank to keep existing secret") || ""}
            value={oidcClientSecret}
            onChange={(e) => setOidcClientSecret(e.target.value)}
            disabled={loading || oidcLoading}
          />
          <p className="text-xs sm:text-sm text-text-muted">{translate("This value is write-only after saving.")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="sm:text-base">{translate("Scopes")}</Label>
          <Input
            placeholder="openid profile email"
            value={oidcForm.oidcScopes}
            onChange={(e) => updateOidcForm("oidcScopes", e.target.value)}
            disabled={loading || oidcLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="sm:text-base">{translate("Login Button Label")}</Label>
          <Input
            placeholder={translate("Sign in with OIDC") || ""}
            value={oidcForm.oidcLoginLabel}
            onChange={(e) => updateOidcForm("oidcLoginLabel", e.target.value)}
            disabled={loading || oidcLoading}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-bg p-3 text-xs sm:text-sm text-text-muted">
        <p className="font-medium text-text-main mb-1">{translate("Redirect URI")}</p>
        <code className="block break-all font-mono">{oidcRedirectUri}</code>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/50">
        <Button type="button" variant="primary" loading={oidcLoading} onClick={() => saveOidcSettings()} className="w-full sm:w-auto">
          {translate("Save OIDC settings")}
        </Button>
        <Button type="button" variant="outline" loading={oidcTestLoading} onClick={testOidcConnection} className="w-full sm:w-auto">
          {translate("Test connection")}
        </Button>
      </div>

      {oidcTestStatus.message && (
        <p className={`text-xs sm:text-sm ${oidcTestStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
          {oidcTestStatus.message}
        </p>
      )}

      {oidcStatus.message && (
        <p className={`text-xs sm:text-sm ${oidcStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
          {oidcStatus.message}
        </p>
      )}
    </div>
  );
}
