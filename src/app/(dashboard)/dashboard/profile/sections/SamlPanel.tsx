"use client";

import { FormInput as Input } from "@/components/ui/form-input";
import { Button } from "@/components/ui/button";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Upload, Copy, Download, ChevronDown } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { StatusMessage } from "../types";

interface SamlPanelProps {
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
  authMode: string;
  loading: boolean;
}

export default function SamlPanel({
  samlForm, samlStatus, setSamlStatus, samlLoading, samlTestLoading, samlTestStatus,
  showSamlGuide, setShowSamlGuide,
  idpMetadataFileRef, certFileRef,
  updateSamlForm, handleIdpMetadataUpload, handleCertFileUpload,
  saveSamlSettings, testSamlConnection,
  samlAcsUrl, samlMetadataUrl,
  authMode, loading,
}: SamlPanelProps) {
  return (
    <div className="flex flex-col gap-4 pt-2 border-t border-border/50">
      {/* IdP Setup Guidelines Banner & Collapsible Drawer */}
      <div className="rounded-lg border border-border bg-bg/80 overflow-hidden">
        <Button
          variant="ghost"
          type="button"
          onClick={() => setShowSamlGuide((prev) => !prev)}
          className="w-full p-3 flex items-center justify-between gap-2 text-left hover:bg-surface/50 transition-colors justify-start h-auto"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="size-4" />
            <div>
              <p className="font-semibold text-xs sm:text-sm text-text-main">
                {translate("IdP Setup Guidelines & Provider Setup Instructions")}
              </p>
              <p className="text-[11px] text-text-muted">
                {translate("Click to see setup steps for AWS IAM Identity Center, Okta, Entra ID, Keycloak & Authentik")}
              </p>
            </div>
          </div>
          <ChevronDown className={`size-5 text-text-muted transition-transform text-lg ${showSamlGuide ? "rotate-180" : ""}`} />
        </Button>

        {showSamlGuide && (
          <div className="p-4 border-t border-border bg-surface/30 text-xs text-text-main flex flex-col gap-3">
            <div className="p-2.5 rounded border border-primary/20 bg-primary/5 text-primary text-xs">
              <p className="font-semibold mb-1">🔑 {translate("Required Service Provider (SP) Values for your IdP Configuration:")}</p>
              <ul className="list-disc pl-4 flex flex-col gap-1 font-mono text-[11px]">
                <li>
                  <b>{translate("Assertion Consumer Service (ACS) URL:")}</b>{" "}
                  <code className="bg-bg px-1 py-0.5 rounded break-all">{samlAcsUrl}</code>
                </li>
                <li>
                  <b>{translate("SP Entity ID / Audience URI:")}</b>{" "}
                  <code className="bg-bg px-1 py-0.5 rounded break-all">{samlForm.samlIssuer || "urn:modelhub:sp"}</code>
                </li>
                <li>
                  <b>{translate("NameID Format:")}</b>{" "}
                  <code className="bg-bg px-1 py-0.5 rounded">EmailAddress</code> {translate("or")} <code className="bg-bg px-1 py-0.5 rounded">Unspecified</code>
                </li>
              </ul>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                <p className="font-semibold text-text-main flex items-center gap-1.5">
                  <span>☁️</span> AWS IAM Identity Center
                </p>
                <ol className="list-decimal pl-4 text-text-muted flex flex-col gap-1">
                  <li>Applications → <b>Add application</b> → {translate("Select")} <b>Add custom SAML 2.0 application</b>.</li>
                  <li>{translate("Set")} <b>Application ACS URL</b> {translate("to")} <code className="text-text-main font-mono">{samlAcsUrl}</code>.</li>
                  <li>{translate("Set")} <b>Application SAML audience</b> {translate("to")} <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:modelhub:sp"}</code>.</li>
                  <li>{translate("In")} <i>Attribute mappings</i>, {translate("map")} <code className="text-text-main font-mono">Subject</code> {translate("or")} <code className="text-text-main font-mono">email</code> {translate("to")} <code className="text-text-main font-mono">${`{user:email}`}</code>.</li>
                  <li>{translate("Download the")} <b>IAM Identity Center SAML metadata XML</b> {translate("file and use the 1-Click Import below!")}</li>
                </ol>
              </div>

              <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                <p className="font-semibold text-text-main flex items-center gap-1.5">
                  <span>🔷</span> Microsoft Entra ID (Azure AD)
                </p>
                <ol className="list-decimal pl-4 text-text-muted flex flex-col gap-1">
                  <li>Enterprise Applications → <b>New application</b> → <b>Create your own application</b>.</li>
                  <li>{translate("Select")} <b>Single sign-on</b> → <b>SAML</b>.</li>
                  <li><b>Identifier (Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:modelhub:sp"}</code></li>
                  <li><b>Reply URL (ACS):</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                  <li>{translate("Download the")} <b>Federation Metadata XML</b> {translate("and import or copy the X.509 Certificate.")}</li>
                </ol>
              </div>

              <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                <p className="font-semibold text-text-main flex items-center gap-1.5">
                  <span>🟢</span> Okta / Auth0
                </p>
                <ol className="list-decimal pl-4 text-text-muted flex flex-col gap-1">
                  <li>Applications → <b>Create App Integration</b> → {translate("Select")} <b>SAML 2.0</b>.</li>
                  <li><b>Single Sign-On URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                  <li><b>Audience URI (SP Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:modelhub:sp"}</code></li>
                  <li>{translate("Name ID Format:")} <i>EmailAddress</i>.</li>
                  <li>{translate("Download the Identity Provider metadata XML or copy the X.509 certificate.")}</li>
                </ol>
              </div>

              <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                <p className="font-semibold text-text-main flex items-center gap-1.5">
                  <span>🛡️</span> Keycloak / Authentik
                </p>
                <ol className="list-decimal pl-4 text-text-muted flex flex-col gap-1">
                  <li>Clients → <b>Create client</b> → {translate("Select")} <b>SAML</b>.</li>
                  <li><b>Client ID:</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:modelhub:sp"}</code></li>
                  <li><b>Master SAML Processing URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                  <li>{translate("Export the SAML Descriptor XML or copy the IDP Certificate PEM.")}</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Import Card */}
      <div className="p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm text-text-main">{translate("1-Click IdP XML Metadata Import")}</p>
          <p className="text-xs text-text-muted">{translate("Auto-fill SSO URL, Issuer & Certificate from XML metadata")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<Upload className="size-4" />}
          onClick={() => idpMetadataFileRef.current?.click()}
        >
          {translate("Load XML Metadata")}
        </Button>
        <ShadcnInput
          ref={idpMetadataFileRef}
          type="file"
          accept=".xml,application/xml,text/xml"
          className="hidden"
          onChange={handleIdpMetadataUpload}
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="flex flex-col gap-2">
          <Label className="sm:text-base">{translate("Single Sign-On Service URL (samlEntryPoint)")}</Label>
          <Input
            placeholder="https://idp.example.com/app/saml/sso/..."
            value={samlForm.samlEntryPoint}
            onChange={(e) => updateSamlForm("samlEntryPoint", e.target.value)}
            disabled={loading || samlLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="sm:text-base">{translate("SP Entity ID / Audience (samlIssuer)")}</Label>
          <Input
            placeholder="urn:modelhub:sp"
            value={samlForm.samlIssuer}
            onChange={(e) => updateSamlForm("samlIssuer", e.target.value)}
            disabled={loading || samlLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label className="sm:text-base">{translate("IdP X.509 Certificate (samlCert)")}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<Upload className="size-4" />}
              onClick={() => certFileRef.current?.click()}
            >
              {translate("Load Certificate")}
            </Button>
            <ShadcnInput
              ref={certFileRef}
              type="file"
              accept=".crt,.pem,.cer,text/plain"
              className="hidden"
              onChange={handleCertFileUpload}
            />
          </div>
          <Textarea
            rows={4}
            placeholder="-----BEGIN CERTIFICATE-----&#10;MIIC...&#10;-----END CERTIFICATE-----"
            value={samlForm.samlCert}
            onChange={(e) => updateSamlForm("samlCert", e.target.value)}
            className="text-xs font-mono"
            disabled={loading || samlLoading}
          />
          <p className="text-xs text-text-muted">{translate("Paste the raw Base64 certificate or PEM block.")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="sm:text-base">{translate("Login Button Label")}</Label>
            <Input
              placeholder="Entrar com SAML SSO"
              value={samlForm.samlLoginLabel}
              onChange={(e) => updateSamlForm("samlLoginLabel", e.target.value)}
              disabled={loading || samlLoading}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="sm:text-base">{translate("Email Claim Attribute")}</Label>
            <Input
              placeholder="email"
              value={samlForm.samlAttributeEmail}
              onChange={(e) => updateSamlForm("samlAttributeEmail", e.target.value)}
              disabled={loading || samlLoading}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="sm:text-base">{translate("Display Name Claim")}</Label>
            <Input
              placeholder="name"
              value={samlForm.samlAttributeName}
              onChange={(e) => updateSamlForm("samlAttributeName", e.target.value)}
              disabled={loading || samlLoading}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-bg text-xs sm:text-sm text-text-muted">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-medium text-text-main">{translate("ACS Callback URL")}</p>
            <code className="block break-all font-mono text-xs">{samlAcsUrl}</code>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Copy className="size-4" />}
            onClick={() => {
              navigator.clipboard.writeText(samlAcsUrl);
              setSamlStatus({ type: "success", message: translate("ACS URL copied to clipboard!") || "ACS URL copied to clipboard!" });
            }}
          >
            Copiar
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
          <div>
            <p className="font-medium text-text-main">{translate("SP XML Metadata")}</p>
            <code className="block break-all font-mono text-xs">{samlMetadataUrl}</code>
          </div>
          <a
            href={samlMetadataUrl}
            target="_blank"
            rel="noopener noreferrer"
            download="modelhub-sp-metadata.xml"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Download className="size-4" />
            {translate("Download XML")}
          </a>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/50">
        <Button
          type="button"
          variant="primary"
          loading={samlLoading}
          onClick={() => saveSamlSettings(authMode)}
          className="w-full sm:w-auto"
        >
          {translate("Save SAML settings")}
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={samlTestLoading}
          onClick={testSamlConnection}
          className="w-full sm:w-auto"
        >
          {translate("Test SAML settings")}
        </Button>
      </div>

      {samlTestStatus.message && (
        <p className={`text-xs sm:text-sm ${samlTestStatus.type === "error" ? "text-destructive-foreground" : "text-success-foreground"}`}>
          {samlTestStatus.message}
        </p>
      )}

      {samlStatus.message && (
        <p className={`text-xs sm:text-sm ${samlStatus.type === "error" ? "text-destructive-foreground" : "text-success-foreground"}`}>
          {samlStatus.message}
        </p>
      )}
    </div>
  );
}


