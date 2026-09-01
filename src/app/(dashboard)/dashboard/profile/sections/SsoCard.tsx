"use client";

import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Unlock, ChevronDown, ChevronUp } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { Settings, StatusMessage } from "../types";
import SsoModeSelector from "./SsoModeSelector";
import SamlPanel from "./SamlPanel";
import OidcPanel from "./OidcPanel";

interface SsoCardProps {
  settings: Settings;
  loading: boolean;
  // OIDC
  oidcForm: { authMode: string; oidcIssuerUrl: string; oidcClientId: string; oidcScopes: string; oidcLoginLabel: string };
  oidcClientSecret: string;
  setOidcClientSecret: React.Dispatch<React.SetStateAction<string>>;
  oidcStatus: StatusMessage;
  oidcLoading: boolean;
  oidcTestLoading: boolean;
  oidcTestStatus: StatusMessage;
  oidcExpanded: boolean;
  setOidcExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  updateOidcForm: (field: string, value: string) => void;
  saveOidcSettings: (authMode?: string) => Promise<void>;
  testOidcConnection: () => Promise<void>;
  oidcRedirectUri: string;
  // SAML
  ssoTypeTab: string;
  setSsoTypeTab: React.Dispatch<React.SetStateAction<string>>;
  samlForm: { samlEntryPoint: string; samlIssuer: string; samlCert: string; samlLoginLabel: string; samlAttributeEmail: string; samlAttributeName: string };
  samlStatus: StatusMessage;
  setSamlStatus: React.Dispatch<React.SetStateAction<StatusMessage>>;
  samlLoading: boolean;
  samlTestLoading: boolean;
  samlTestStatus: StatusMessage;
  showSamlGuide: boolean;
  setShowSamlGuide: React.Dispatch<React.SetStateAction<boolean>>;
  idpMetadataFileRef: React.RefObject<HTMLInputElement | null>;
  certFileRef: React.RefObject<HTMLInputElement | null>;
  updateSamlForm: (field: string, value: string) => void;
  handleIdpMetadataUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleCertFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  saveSamlSettings: (targetAuthMode?: string) => Promise<void>;
  testSamlConnection: () => Promise<void>;
  samlAcsUrl: string;
  samlMetadataUrl: string;
}

export default function SsoCard({
  settings, loading,
  oidcForm, oidcClientSecret, setOidcClientSecret,
  oidcStatus, oidcLoading, oidcTestLoading, oidcTestStatus,
  oidcExpanded, setOidcExpanded,
  updateOidcForm, saveOidcSettings, testOidcConnection, oidcRedirectUri,
  ssoTypeTab, setSsoTypeTab,
  samlForm, samlStatus, setSamlStatus, samlLoading, samlTestLoading, samlTestStatus,
  showSamlGuide, setShowSamlGuide,
  idpMetadataFileRef, certFileRef,
  updateSamlForm, handleIdpMetadataUpload, handleCertFileUpload,
  saveSamlSettings, testSamlConnection,
  samlAcsUrl, samlMetadataUrl,
}: SsoCardProps) {
  return (
    <Card>
      <Button
        variant="ghost"
        type="button"
        onClick={() => setOidcExpanded((v) => !v)}
        className="w-full flex items-center gap-3 text-left justify-start"
      >
        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 shrink-0">
          <Unlock className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Single Sign-On (SSO)</h3>
          <p className="text-xs text-text-muted">
            {settings.authMode === "sso" || settings.authMode === "oidc" || settings.authMode === "saml"
              ? `${settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"} ${translate("SSO active") || "SSO active"}`
              : settings.authMode === "both"
                ? `${translate("Password") || "Password"} + ${settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"} ${translate("active") || "active"}`
                : translate("Optional SSO via Okta, Entra ID, Keycloak or OIDC") || "Optional SSO via Okta, Entra ID, Keycloak or OIDC"}
          </p>
        </div>
        {oidcExpanded ? <ChevronUp className="size-5 text-text-muted shrink-0" /> : <ChevronDown className="size-5 text-text-muted shrink-0" />}
      </Button>
      {oidcExpanded && (
        <div className="flex flex-col gap-4 mt-4">
          <p className="text-xs sm:text-sm text-text-muted">
            {translate("Configure enterprise Single Sign-On (SSO) for dashboard access using SAML 2.0 or OIDC.")}
          </p>

          <SsoModeSelector
            ssoTypeTab={ssoTypeTab}
            setSsoTypeTab={setSsoTypeTab}
            authMode={oidcForm.authMode}
            updateOidcForm={updateOidcForm}
            loading={loading}
            oidcLoading={oidcLoading}
            samlLoading={samlLoading}
          />

          {ssoTypeTab === "saml" ? (
            <SamlPanel
              samlForm={samlForm}
              samlStatus={samlStatus}
              setSamlStatus={setSamlStatus}
              samlLoading={samlLoading}
              samlTestLoading={samlTestLoading}
              samlTestStatus={samlTestStatus}
              showSamlGuide={showSamlGuide}
              setShowSamlGuide={setShowSamlGuide}
              idpMetadataFileRef={idpMetadataFileRef}
              certFileRef={certFileRef}
              updateSamlForm={updateSamlForm}
              handleIdpMetadataUpload={handleIdpMetadataUpload}
              handleCertFileUpload={handleCertFileUpload}
              saveSamlSettings={saveSamlSettings}
              testSamlConnection={testSamlConnection}
              samlAcsUrl={samlAcsUrl}
              samlMetadataUrl={samlMetadataUrl}
              authMode={oidcForm.authMode}
              loading={loading}
            />
          ) : (
            <OidcPanel
              oidcForm={oidcForm}
              oidcClientSecret={oidcClientSecret}
              setOidcClientSecret={setOidcClientSecret}
              oidcStatus={oidcStatus}
              oidcLoading={oidcLoading}
              oidcTestLoading={oidcTestLoading}
              oidcTestStatus={oidcTestStatus}
              updateOidcForm={updateOidcForm}
              saveOidcSettings={saveOidcSettings}
              testOidcConnection={testOidcConnection}
              oidcRedirectUri={oidcRedirectUri}
              loading={loading}
            />
          )}

          {settings.authMode === "oidc" || settings.authMode === "saml" || settings.authMode === "sso" ? (
            <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
              {translate("SSO login")} ({settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"}) {translate("is currently active. Password login is disabled until you change back.")}
            </p>
          ) : null}

          {settings.authMode === "both" && (
            <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
              {translate("Password login and SSO")} ({settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"}) {translate("are both active.")}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
