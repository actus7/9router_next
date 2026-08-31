"use client";

import { useState, useRef } from "react";
import { translate } from "@/i18n/runtime";
import type { Settings, StatusMessage } from "../types";

export function useSsoConfig(initialSettings: Settings, settings: Settings, setSettings: React.Dispatch<React.SetStateAction<Settings>>) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const oidcRedirectUri = origin ? `${origin}/api/auth/oidc/callback` : "/api/auth/oidc/callback";
  const samlAcsUrl = origin ? `${origin}/api/auth/saml/acs` : "/api/auth/saml/acs";
  const samlMetadataUrl = origin ? `${origin}/api/auth/saml/metadata` : "/api/auth/saml/metadata";

  // OIDC State
  const [oidcForm, setOidcForm] = useState({
    authMode: initialSettings?.authMode || "password",
    oidcIssuerUrl: (initialSettings?.oidcIssuerUrl as string) || "",
    oidcClientId: (initialSettings?.oidcClientId as string) || "",
    oidcScopes: (initialSettings?.oidcScopes as string) || "openid profile email",
    oidcLoginLabel: (initialSettings?.oidcLoginLabel as string) || "Entrar com OIDC",
  });
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcStatus, setOidcStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcTestLoading, setOidcTestLoading] = useState(false);
  const [oidcTestStatus, setOidcTestStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [oidcExpanded, setOidcExpanded] = useState(
    initialSettings?.authMode === "sso" ||
    initialSettings?.authMode === "saml" ||
    initialSettings?.authMode === "oidc" ||
    initialSettings?.authMode === "both"
  );

  // SAML State
  const [ssoTypeTab, setSsoTypeTab] = useState(initialSettings?.ssoType || "saml");
  const [samlForm, setSamlForm] = useState({
    samlEntryPoint: (initialSettings?.samlEntryPoint as string) || "",
    samlIssuer: (initialSettings?.samlIssuer as string) || "urn:9router:sp",
    samlCert: (initialSettings?.samlCert as string) || "",
    samlLoginLabel: (initialSettings?.samlLoginLabel as string) || "Entrar com SAML SSO",
    samlAttributeEmail: (initialSettings?.samlAttributeEmail as string) || "email",
    samlAttributeName: (initialSettings?.samlAttributeName as string) || "name",
  });
  const [samlStatus, setSamlStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [samlLoading, setSamlLoading] = useState(false);
  const [samlTestLoading, setSamlTestLoading] = useState(false);
  const [samlTestStatus, setSamlTestStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [showSamlGuide, setShowSamlGuide] = useState(false);
  const idpMetadataFileRef = useRef<HTMLInputElement>(null);
  const certFileRef = useRef<HTMLInputElement>(null);

  // OIDC Handlers
  const updateOidcForm = (field: string, value: string) => {
    setOidcForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveOidcSettings = async (authMode = oidcForm.authMode || "password") => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const loginLabel = oidcForm.oidcLoginLabel.trim();
    const secret = oidcClientSecret.trim();

    if (authMode !== "password" && (!issuerUrl || !clientId || !secret) && !settings.oidcConfigured) {
      setOidcStatus({ type: "error", message: translate("Issuer URL, Client ID and Client Secret are required to enable OIDC.") || "Issuer URL, Client ID and Client Secret are required to enable OIDC." });
      return;
    }

    setOidcLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    try {
      const payload: Record<string, string> = {
        authMode,
        ssoType: "oidc",
        oidcIssuerUrl: issuerUrl,
        oidcClientId: clientId,
        oidcScopes: scopes || "openid profile email",
        oidcLoginLabel: loginLabel || "Entrar com OIDC",
      };
      if (secret) {
        payload.oidcClientSecret = secret;
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setOidcForm({
          authMode: data?.authMode || authMode,
          oidcIssuerUrl: data?.oidcIssuerUrl || issuerUrl,
          oidcClientId: data?.oidcClientId || clientId,
          oidcScopes: data?.oidcScopes || scopes || "openid profile email",
          oidcLoginLabel: data?.oidcLoginLabel || loginLabel || "Entrar com OIDC",
        });
        setOidcClientSecret("");
        setOidcStatus({
          type: "success",
          message:
            authMode === "oidc"
              ? translate("OIDC login enabled") || "OIDC login enabled"
              : authMode === "both"
                ? translate("Password and OIDC login enabled") || "Password and OIDC login enabled"
                : translate("OIDC settings saved") || "OIDC settings saved",
        });
      } else {
        setOidcStatus({ type: "error", message: data.error || translate("Failed to save OIDC settings") || "Failed to save OIDC settings" });
      }
    } catch (err) {
      setOidcStatus({ type: "error", message: translate("An error occurred") || "An error occurred" });
    } finally {
      setOidcLoading(false);
    }
  };

  const testOidcConnection = async () => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const secret = oidcClientSecret.trim();

    if (!issuerUrl || !clientId) {
      setOidcTestStatus({ type: "error", message: translate("Issuer URL and Client ID are required to test the connection.") || "Issuer URL and Client ID are required to test the connection." });
      return;
    }

    setOidcTestLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    try {
      const saveRes = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authMode: oidcForm.authMode || settings.authMode || "password",
          oidcIssuerUrl: issuerUrl,
          oidcClientId: clientId,
          oidcScopes: scopes || "openid profile email",
          oidcLoginLabel: oidcForm.oidcLoginLabel.trim() || "Entrar com OIDC",
          ...(secret ? { oidcClientSecret: secret } : {}),
        }),
      });

      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        setOidcTestStatus({
          type: "error",
          message: saved.error || translate("Failed to save OIDC settings before testing") || "Failed to save OIDC settings before testing",
        });
        return;
      }

      const res = await fetch("/api/auth/oidc/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuerUrl: saved.oidcIssuerUrl || issuerUrl,
          clientId: saved.oidcClientId || clientId,
          scopes: saved.oidcScopes || scopes || "openid profile email",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        const statusMessage = data.clientSecretTested
          ? data.clientSecretValid === true
            ? `${translate("Connection OK") || "Connection OK"}. ${translate("Discovery loaded from") || "Discovery loaded from"} ${data.issuerUrl}. ${translate("Client secret validated as well.") || "Client secret validated as well."}`
            : `${translate("Connection OK") || "Connection OK"}. ${translate("Discovery loaded from") || "Discovery loaded from"} ${data.issuerUrl}. ${translate("Client secret was not verified.") || "Client secret was not verified."}`
          : `${translate("Connection OK") || "Connection OK"}. ${translate("Discovery loaded from") || "Discovery loaded from"} ${data.issuerUrl}.`;
        setOidcTestStatus({
          type: "success",
          message: statusMessage,
        });
      } else {
        setOidcTestStatus({ type: "error", message: data.error || translate("OIDC connection test failed") || "OIDC connection test failed" });
      }
    } catch (err) {
      setOidcTestStatus({ type: "error", message: translate("An error occurred") || "An error occurred" });
    } finally {
      setOidcTestLoading(false);
    }
  };

  // SAML Handlers
  const updateSamlForm = (field: string, value: string) => {
    setSamlForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleIdpMetadataUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (idpMetadataFileRef.current) idpMetadataFileRef.current.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xmlText = (e.target?.result as string) || "";
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, "text/xml");
        const parserError = doc.querySelector("parsererror");
        if (parserError) {
          setSamlStatus({ type: "error", message: translate("Could not parse valid SAML IdP metadata from XML file") || "Could not parse valid SAML IdP metadata from XML file" });
          return;
        }

        const entityID = doc.documentElement.getAttribute("entityID") || "";
        const ssoNodes = Array.from(doc.querySelectorAll("SingleSignOnService, *|SingleSignOnService"));
        let ssoUrl = "";
        for (const node of ssoNodes) {
          const binding = node.getAttribute("Binding") || "";
          const location = node.getAttribute("Location") || "";
          if (location) {
            ssoUrl = location;
            if (binding.includes("HTTP-Redirect")) break;
          }
        }

        const certNodes = Array.from(doc.querySelectorAll("X509Certificate, *|X509Certificate"));
        let certStr = "";
        if (certNodes.length > 0) {
          certStr = certNodes[0].textContent?.trim() || "";
        }

        setSamlForm((prev) => ({
          ...prev,
          samlEntryPoint: ssoUrl || prev.samlEntryPoint,
          samlIssuer: prev.samlIssuer || "urn:9router:sp",
          samlCert: certStr || prev.samlCert,
        }));

        setSamlStatus({
          type: "success",
          message: `${translate("IdP metadata imported!") || "IdP metadata imported!"} (${translate("SSO URL") || "SSO URL"}: ${ssoUrl ? translate("found") || "found" : translate("not found") || "not found"}, EntityID: ${entityID ? translate("found") || "found" : translate("not found") || "not found"}, ${translate("Cert") || "Cert"}: ${certStr ? translate("found") || "found" : translate("not found") || "not found"})`,
        });
      } catch (err) {
        setSamlStatus({ type: "error", message: translate("Error reading IdP metadata XML file") || "Error reading IdP metadata XML file" });
      }
    };
    reader.readAsText(file);
  };

  const handleCertFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (certFileRef.current) certFileRef.current.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setSamlForm((prev) => ({ ...prev, samlCert: text.trim() }));
      setSamlStatus({ type: "success", message: translate("Certificate file loaded into configuration.") || "Certificate file loaded into configuration." });
    };
    reader.readAsText(file);
  };

  const saveSamlSettings = async (targetAuthMode = oidcForm.authMode || "password") => {
    setSamlLoading(true);
    setSamlStatus({ type: "", message: "" });
    setSamlTestStatus({ type: "", message: "" });

    try {
      const payload = {
        authMode: targetAuthMode,
        ssoType: "saml",
        samlEntryPoint: samlForm.samlEntryPoint.trim(),
        samlIssuer: samlForm.samlIssuer.trim() || "urn:9router:sp",
        samlCert: samlForm.samlCert.trim(),
        samlLoginLabel: samlForm.samlLoginLabel.trim() || "Entrar com SAML SSO",
        samlAttributeEmail: samlForm.samlAttributeEmail.trim() || "email",
        samlAttributeName: samlForm.samlAttributeName.trim() || "name",
      };

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setSamlForm({
          samlEntryPoint: data?.samlEntryPoint || payload.samlEntryPoint,
          samlIssuer: data?.samlIssuer || payload.samlIssuer,
          samlCert: data?.samlCert || payload.samlCert,
          samlLoginLabel: data?.samlLoginLabel || payload.samlLoginLabel,
          samlAttributeEmail: data?.samlAttributeEmail || payload.samlAttributeEmail,
          samlAttributeName: data?.samlAttributeName || payload.samlAttributeName,
        });
        setSamlStatus({
          type: "success",
          message:
            targetAuthMode === "sso" || targetAuthMode === "saml"
              ? translate("SAML SSO login enabled") || "SAML SSO login enabled"
              : targetAuthMode === "both"
                ? translate("Password and SAML SSO login enabled") || "Password and SAML SSO login enabled"
                : translate("SAML 2.0 settings saved") || "SAML 2.0 settings saved",
        });
      } else {
        setSamlStatus({ type: "error", message: data.error || translate("Failed to save SAML settings") || "Failed to save SAML settings" });
      }
    } catch {
      setSamlStatus({ type: "error", message: translate("An error occurred while saving SAML settings") || "An error occurred while saving SAML settings" });
    } finally {
      setSamlLoading(false);
    }
  };

  const testSamlConnection = async () => {
    setSamlTestLoading(true);
    setSamlStatus({ type: "", message: "" });
    setSamlTestStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/auth/saml/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          samlEntryPoint: samlForm.samlEntryPoint.trim(),
          samlIssuer: samlForm.samlIssuer.trim(),
          samlCert: samlForm.samlCert.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setSamlTestStatus({ type: "success", message: data.message || translate("SAML configuration verified!") || "SAML configuration verified!" });
      } else {
        setSamlTestStatus({ type: "error", message: data.error || translate("SAML configuration test failed") || "SAML configuration test failed" });
      }
    } catch {
      setSamlTestStatus({ type: "error", message: translate("An error occurred while testing SAML configuration") || "An error occurred while testing SAML configuration" });
    } finally {
      setSamlTestLoading(false);
    }
  };

  return {
    // OIDC
    oidcForm, setOidcForm,
    oidcClientSecret, setOidcClientSecret,
    oidcStatus, setOidcStatus,
    oidcLoading, setOidcLoading,
    oidcTestLoading, setOidcTestLoading,
    oidcTestStatus, setOidcTestStatus,
    oidcExpanded, setOidcExpanded,
    updateOidcForm, saveOidcSettings, testOidcConnection,
    oidcRedirectUri,
    // SAML
    ssoTypeTab, setSsoTypeTab,
    samlForm, setSamlForm,
    samlStatus, setSamlStatus,
    samlLoading, setSamlLoading,
    samlTestLoading, setSamlTestLoading,
    samlTestStatus, setSamlTestStatus,
    showSamlGuide, setShowSamlGuide,
    idpMetadataFileRef, certFileRef,
    updateSamlForm, handleIdpMetadataUpload, handleCertFileUpload,
    saveSamlSettings, testSamlConnection,
    samlAcsUrl, samlMetadataUrl,
  };
}
