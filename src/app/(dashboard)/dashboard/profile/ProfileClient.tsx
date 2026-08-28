"use client";

import { useState, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, Button, Input } from "@/shared/components";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Modal from "@/shared/components/Modal";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/lib/utils";
import { APP_CONFIG } from "@/shared/constants/config";
import { LOCALE_COOKIE, type Locale, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import { BarChart3, BookOpen, ChevronDown, ChevronUp, Contrast, Copy, Download, Globe, LogOut, Monitor, Moon, Route, Shield, Sun, Unlock, Upload, Wifi } from "lucide-react";

interface Settings {
  fallbackStrategy?: string;
  comboStrategy?: string;
  stickyRoundRobinLimit?: number;
  comboStickyRoundRobinLimit?: number;
  requireLogin?: boolean;
  hasPassword?: boolean;
  authMode?: string;
  ssoType?: string;
  oidcConfigured?: boolean;
  samlConfigured?: boolean;
  enableObservability?: boolean;
  outboundProxyEnabled?: boolean;
  outboundProxyUrl?: string;
  outboundNoProxy?: string;
  [key: string]: unknown;
}

interface StatusMessage {
  type: string;
  message: string;
}

interface ProfileClientProps {
  initialSettings: Settings;
  initialDbInfo: Record<string, unknown>;
}

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function ProfileClient({ initialSettings, initialDbInfo }: ProfileClientProps) {
  const { theme, setTheme, isDark } = useTheme();
  const [locale, setLocale] = useState(() => getLocaleFromCookie());
  const [langOpen, setLangOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [loading, setLoading] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [dbAuth, setDbAuth] = useState({ open: false, mode: "", password: "" });
  const pendingImportRef = useRef<File | null>(null);
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

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const oidcRedirectUri = origin ? `${origin}/api/auth/oidc/callback` : "/api/auth/oidc/callback";
  const samlAcsUrl = origin ? `${origin}/api/auth/saml/acs` : "/api/auth/saml/acs";
  const samlMetadataUrl = origin ? `${origin}/api/auth/saml/metadata` : "/api/auth/saml/metadata";
  
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

  const importFileRef = useRef<HTMLInputElement>(null);
  const [proxyForm, setProxyForm] = useState({
    outboundProxyEnabled: initialSettings?.outboundProxyEnabled === true,
    outboundProxyUrl: (initialSettings?.outboundProxyUrl as string) || "",
    outboundNoProxy: (initialSettings?.outboundNoProxy as string) || "",
  });
  const [proxyStatus, setProxyStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  const updateOutboundProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProxyUrl: proxyForm.outboundProxyUrl,
          outboundNoProxy: proxyForm.outboundNoProxy,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyStatus({ type: "success", message: "Configurações de proxy aplicadas" });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Falha ao atualizar configurações de proxy" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "Ocorreu um erro" });
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;

    const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
    if (!proxyUrl) {
      setProxyStatus({ type: "error", message: "Por favor, insira uma URL de Proxy para testar" });
      return;
    }

    setProxyTestLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings/proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl }),
      });

      const data = await res.json();
      if (res.ok && data?.ok) {
        setProxyStatus({
          type: "success",
          message: `Teste de proxy OK (${data.status}) em ${data.elapsedMs}ms`,
        });
      } else {
        setProxyStatus({
          type: "error",
          message: data?.error || "Teste de proxy falhou",
        });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "Ocorreu um erro" });
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled: boolean) => {
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundProxyEnabled }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyForm((prev) => ({ ...prev, outboundProxyEnabled: data?.outboundProxyEnabled === true }));
        setProxyStatus({
          type: "success",
          message: outboundProxyEnabled ? "Proxy habilitado" : "Proxy desabilitado",
        });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Falha ao atualizar configurações de proxy" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "Ocorreu um erro" });
    } finally {
      setProxyLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "As senhas não coincidem" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setPassStatus({ type: "success", message: "Senha atualizada com sucesso" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({ type: "error", message: data.error || "Falha ao atualizar senha" });
      }
    } catch (err) {
      setPassStatus({ type: "error", message: "Ocorreu um erro" });
    } finally {
      setPassLoading(false);
    }
  };

  const updateFallbackStrategy = async (strategy: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallbackStrategy: strategy }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error("Falha ao atualizar configurações:", err);
    }
  };

  const updateComboStrategy = async (strategy: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategy: strategy }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, comboStrategy: strategy }));
      }
    } catch (err) {
      console.error("Falha ao atualizar estratégia de combo:", err);
    }
  };

  const updateStickyLimit = async (limit: string) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Falha ao atualizar limite sticky:", err);
    }
  };

  const updateComboStickyLimit = async (limit: string) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, comboStickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Falha ao atualizar limite sticky de combo:", err);
    }
  };

  const updateRequireLogin = async (requireLogin: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Falha ao atualizar exigir login:", err);
    }
  };

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
      setOidcStatus({ type: "error", message: "URL do Emissor, ID do Cliente e Segredo do Cliente são obrigatórios para habilitar OIDC." });
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
              ? "Login OIDC habilitado"
              : authMode === "both"
                ? "Login por senha e OIDC habilitado"
                : "Configurações OIDC salvas",
        });
      } else {
        setOidcStatus({ type: "error", message: data.error || "Falha ao salvar configurações OIDC" });
      }
    } catch (err) {
      setOidcStatus({ type: "error", message: "Ocorreu um erro" });
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
      setOidcTestStatus({ type: "error", message: "URL do Emissor e ID do Cliente são obrigatórios para testar a conexão." });
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
          message: saved.error || "Falha ao salvar configurações OIDC antes de testar",
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
            ? `Conexão OK. Discovery carregado de ${data.issuerUrl}. Segredo do cliente validado também.`
            : `Conexão OK. Discovery carregado de ${data.issuerUrl}. Segredo do cliente não foi verificado.`
          : `Conexão OK. Discovery carregado de ${data.issuerUrl}.`;
        setOidcTestStatus({
          type: "success",
          message: statusMessage,
        });
      } else {
        setOidcTestStatus({ type: "error", message: data.error || "Teste de conexão OIDC falhou" });
      }
    } catch (err) {
      setOidcTestStatus({ type: "error", message: "Ocorreu um erro" });
    } finally {
      setOidcTestLoading(false);
    }
  };

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
          setSamlStatus({ type: "error", message: "Não foi possível analisar metadados SAML IdP válidos do arquivo XML" });
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
          message: `Metadados IdP importados! (SSO URL: ${ssoUrl ? "encontrado" : "não encontrado"}, EntityID: ${entityID ? "encontrado" : "não encontrado"}, Cert: ${certStr ? "encontrado" : "não encontrado"})`,
        });
      } catch (err) {
        setSamlStatus({ type: "error", message: "Erro ao ler arquivo XML de metadados IdP" });
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
      setSamlStatus({ type: "success", message: "Arquivo de certificado carregado na configuração." });
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
              ? "Login SAML SSO habilitado"
              : targetAuthMode === "both"
                ? "Login por senha e SAML SSO habilitado"
                : "Configurações SAML 2.0 salvas",
        });
      } else {
        setSamlStatus({ type: "error", message: data.error || "Falha ao salvar configurações SAML" });
      }
    } catch {
      setSamlStatus({ type: "error", message: "Ocorreu um erro ao salvar configurações SAML" });
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
        setSamlTestStatus({ type: "success", message: data.message || "Configuração SAML verificada!" });
      } else {
        setSamlTestStatus({ type: "error", message: data.error || "Teste de configuração SAML falhou" });
      }
    } catch {
      setSamlTestStatus({ type: "error", message: "Ocorreu um erro ao testar configuração SAML" });
    } finally {
      setSamlTestLoading(false);
    }
  };

  const updateObservabilityEnabled = async (enabled: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableObservability: enabled }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, enableObservability: enabled }));
      }
    } catch (err) {
      console.error("Falha ao atualizar habilitar observabilidade:", err);
    }
  };

  const reloadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Falha ao recarregar configurações:", err);
    }
  };

  const handleExportDatabase = async (password: string) => {
    setDbLoading(true);
    setDbStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings/database", {
        headers: { "x-9r-password": password },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao exportar banco de dados");
      }

      const payload = await res.json();
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      anchor.href = url;
      anchor.download = `9router-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setDbStatus({ type: "success", message: "Backup do banco de dados baixado" });
    } catch (err: unknown) {
      setDbStatus({ type: "error", message: err instanceof Error ? err.message : "Falha ao exportar banco de dados" });
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = "";
    if (!file) return;
    pendingImportRef.current = file;
    setDbStatus({ type: "", message: "" });
    setDbAuth({ open: true, mode: "import", password: "" });
  };

  const runImportDatabase = async (password: string) => {
    const file = pendingImportRef.current;
    if (!file) return;
    setDbLoading(true);
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);

      const res = await fetch("/api/settings/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao importar banco de dados");
      }

      await reloadSettings();
      setDbStatus({ type: "success", message: "Banco de dados importado com sucesso" });
    } catch (err: unknown) {
      setDbStatus({ type: "error", message: err instanceof Error ? err.message : "Arquivo de backup inválido" });
    } finally {
      pendingImportRef.current = null;
      setDbLoading(false);
    }
  };

  // Confirm password modal, then run export or import.
  const handleDbAuthConfirm = async () => {
    const { mode, password } = dbAuth;
    setDbAuth({ open: false, mode: "", password: "" });
    if (mode === "export") await handleExportDatabase(password);
    else if (mode === "import") await runImportDatabase(password);
  };

  const observabilityEnabled = settings.enableObservability === true;

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.assign("/login");
      }
    } catch (err) {
      console.error("Falha ao sair:", err);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-6">
        {/* Local Mode Info */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="size-10 sm:size-12 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
                <Monitor className="size-4" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-semibold">Modo Local</h2>
                <p className="text-sm text-text-muted">Executando na sua máquina</p>
              </div>
            </div>
            <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5 w-full sm:w-auto">
              {["light", "dark", "system"].map((option) => (
                <Button
                  key={option}
                  variant="ghost"
                  size="sm"
                  onClick={() => setTheme(option as "light" | "dark" | "system")}
                  className={cn(
                    "flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md font-medium transition-all flex-1 sm:flex-initial",
                    theme === option
                      ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                      : "text-text-muted hover:text-text-main"
                  )}
                >
                  {option === "light" ? <Sun className="size-4" /> : option === "dark" ? <Moon className="size-4" /> : <Contrast className="size-4" />}
                  <span className="capitalize text-xs sm:text-sm">{option}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg bg-bg border border-border gap-2">
              <div>
                <p className="font-medium text-sm sm:text-base">Local do Banco de Dados</p>
                <p className="text-xs sm:text-sm text-text-muted font-mono break-all">~/.9router/db/data.sqlite</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="secondary"
                icon={<Download className="size-4" />}
                onClick={() => setDbAuth({ open: true, mode: "export", password: "" })}
                loading={dbLoading}
                className="w-full sm:w-auto"
              >
                Baixar Backup
              </Button>
              <Button
                variant="outline"
                icon={<Upload className="size-4" />}
                onClick={() => importFileRef.current?.click()}
                disabled={dbLoading}
                className="w-full sm:w-auto"
              >
                Importar Backup
              </Button>
              <ShadcnInput
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleImportDatabase}
              />
            </div>
            {dbStatus.message && (
              <p className={`text-sm ${dbStatus.type === "error" ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
                {dbStatus.message}
              </p>
            )}
          </div>
        </Card>

        {/* Language */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="size-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
              <Globe className="size-5" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Idioma</h3>
          </div>
          <Button
            variant="outline"
            onClick={() => setLangOpen(true)}
            className="flex items-center justify-between w-full p-3 rounded-lg bg-bg border border-border hover:border-primary/50 transition-colors"
            data-i18n-skip="true"
          >
            <span className="text-sm text-text-muted">Idioma de exibição</span>
            <span className="text-2xl">{LOCALE_FLAGS[locale] || "🌐"}</span>
          </Button>
        </Card>

        {/* Security */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <Shield className="size-5" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Segurança</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">Exigir login</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Quando ativado, o painel exige senha. Quando desativado, acesso sem login.
                </p>
              </div>
              <Switch
                checked={settings.requireLogin === true}
                onCheckedChange={() => updateRequireLogin(!settings.requireLogin)}
                disabled={loading}
              />
            </div>
            {settings.requireLogin === true && (
              <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 pt-4 border-t border-border/50">
                {settings.hasPassword && (
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs sm:text-sm">Senha Atual</Label>
                    <Input
                      type="password"
                      placeholder="Digite a senha atual"
                      value={passwords.current}
                      onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                      required
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs sm:text-sm">Nova Senha</Label>
                    <Input
                      type="password"
                      placeholder="Digite a nova senha"
                      value={passwords.new}
                      onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs sm:text-sm">Confirmar Nova Senha</Label>
                    <Input
                      type="password"
                      placeholder="Confirme a nova senha"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {passStatus.message && (
                  <p className={`text-xs sm:text-sm ${passStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
                    {passStatus.message}
                  </p>
                )}

                <div className="pt-2">
                  <Button type="submit" variant="primary" loading={passLoading} className="w-full sm:w-auto">
                    {settings.hasPassword ? "Atualizar Senha" : "Definir Senha"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Card>

        {/* Single Sign-On (SSO) */}
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
                  ? `${settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"} SSO ativo`
                  : settings.authMode === "both"
                    ? `Senha + ${settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"} ativo`
                    : "SSO opcional via Okta, Entra ID, Keycloak ou OIDC"}
              </p>
            </div>
            {oidcExpanded ? <ChevronUp className="size-5 text-text-muted shrink-0" /> : <ChevronDown className="size-5 text-text-muted shrink-0" />}
          </Button>
          {oidcExpanded && (
            <div className="flex flex-col gap-4 mt-4">
              <p className="text-xs sm:text-sm text-text-muted">
                Configure Single Sign-On (SSO) empresarial para acesso ao painel usando SAML 2.0 ou OIDC.
              </p>

              {/* SSO Protocol Switcher Tabs */}
              <div className="flex flex-col gap-2">
                <Label className="sm:text-base">Protocolo SSO</Label>
                <div className="flex p-1 rounded-lg bg-black/5 dark:bg-white/5 border border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setSsoTypeTab("saml")}
                    className={cn(
                      "flex-1 py-1.5 px-3 rounded-md font-medium text-xs sm:text-sm transition-all text-center",
                      ssoTypeTab === "saml"
                        ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    )}
                  >
                    SAML 2.0
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setSsoTypeTab("oidc")}
                    className={cn(
                      "flex-1 py-1.5 px-3 rounded-md font-medium text-xs sm:text-sm transition-all text-center",
                      ssoTypeTab === "oidc"
                        ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    )}
                  >
                    OIDC
                  </Button>
                </div>
              </div>

              {/* Auth Mode selection */}
              <div className="flex flex-col gap-2">
                <Label className="sm:text-base">Modo de Autenticação</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    {
                      value: "password",
                      title: "Apenas senha",
                      desc: "Manter login por senha legado.",
                    },
                    {
                      value: "sso",
                      title: `Apenas ${ssoTypeTab === "saml" ? "SAML" : "OIDC"}`,
                      desc: "Exigir SSO para acesso ao painel.",
                    },
                    {
                      value: "both",
                      title: "Ambos",
                      desc: "Permitir login por senha ou SSO.",
                    },
                  ].map((option) => {
                    const currentMode = oidcForm.authMode;
                    const active =
                      option.value === "password"
                        ? currentMode === "password"
                        : option.value === "sso"
                          ? currentMode === "sso" || currentMode === "saml" || currentMode === "oidc"
                          : currentMode === "both";
                    return (
                      <Button
                        key={option.value}
                        variant="outline"
                        type="button"
                        onClick={() => updateOidcForm("authMode", option.value)}
                        className={cn(
                          "text-left rounded-lg border p-3 transition-colors h-auto",
                          active
                            ? "border-primary bg-primary/5"
                            : "border-border bg-bg hover:bg-surface-2/50"
                        )}
                        disabled={loading || oidcLoading || samlLoading}
                      >
                        <div className="text-left">
                          <p className="font-medium text-sm sm:text-base">{option.title}</p>
                          <p className="text-xs sm:text-sm text-text-muted mt-1">{option.desc}</p>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {ssoTypeTab === "saml" ? (
                /* SAML Configuration Panel */
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
                            Diretrizes de Configuração IdP & Instruções de Configuração de Provedores
                          </p>
                          <p className="text-[11px] text-text-muted">
                            Clique para ver as etapas de configuração para AWS IAM Identity Center, Okta, Entra ID, Keycloak & Authentik
                          </p>
                        </div>
                      </div>
                      <ChevronDown className={`size-5 text-text-muted transition-transform text-lg ${showSamlGuide ? "rotate-180" : ""}`} />
                    </Button>

                    {showSamlGuide && (
                      <div className="p-4 border-t border-border bg-surface/30 text-xs text-text-main flex flex-col gap-3">
                        <div className="p-2.5 rounded border border-primary/20 bg-primary/5 text-primary text-xs">
                          <p className="font-semibold mb-1">🔑 Valores Obrigatórios do Provedor de Serviços (SP) para sua Configuração IdP:</p>
                          <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                            <li>
                              <b>URL do Assertion Consumer Service (ACS):</b>{" "}
                              <code className="bg-bg px-1 py-0.5 rounded break-all">{samlAcsUrl}</code>
                            </li>
                            <li>
                              <b>Entity ID do SP / Audience URI:</b>{" "}
                              <code className="bg-bg px-1 py-0.5 rounded break-all">{samlForm.samlIssuer || "urn:9router:sp"}</code>
                            </li>
                            <li>
                              <b>Formato NameID:</b>{" "}
                              <code className="bg-bg px-1 py-0.5 rounded">EmailAddress</code> ou <code className="bg-bg px-1 py-0.5 rounded">Unspecified</code>
                            </li>
                          </ul>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>☁️</span> AWS IAM Identity Center
                            </p>
                            <ol className="list-decimal pl-4 text-text-muted space-y-1">
                              <li>Applications → <b>Add application</b> → Selecione <b>Add custom SAML 2.0 application</b>.</li>
                              <li>Defina <b>Application ACS URL</b> como <code className="text-text-main font-mono">{samlAcsUrl}</code>.</li>
                              <li>Defina <b>Application SAML audience</b> como <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:9router:sp"}</code>.</li>
                              <li>Em <i>Attribute mappings</i>, mapeie <code className="text-text-main font-mono">Subject</code> ou <code className="text-text-main font-mono">email</code> para <code className="text-text-main font-mono">${`{user:email}`}</code>.</li>
                              <li>Baixe o arquivo <b>IAM Identity Center SAML metadata XML</b> e use a Importação 1-Click abaixo!</li>
                            </ol>
                          </div>

                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>🔷</span> Microsoft Entra ID (Azure AD)
                            </p>
                            <ol className="list-decimal pl-4 text-text-muted space-y-1">
                              <li>Enterprise Applications → <b>New application</b> → <b>Create your own application</b>.</li>
                              <li>Selecione <b>Single sign-on</b> → <b>SAML</b>.</li>
                              <li><b>Identifier (Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:9router:sp"}</code></li>
                              <li><b>Reply URL (ACS):</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                              <li>Baixe o <b>Federation Metadata XML</b> e importe ou copie o Certificado X.509.</li>
                            </ol>
                          </div>

                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>🟢</span> Okta / Auth0
                            </p>
                            <ol className="list-decimal pl-4 text-text-muted space-y-1">
                              <li>Applications → <b>Create App Integration</b> → Selecione <b>SAML 2.0</b>.</li>
                              <li><b>Single Sign-On URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                              <li><b>Audience URI (SP Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:9router:sp"}</code></li>
                              <li>Formato Name ID: <i>EmailAddress</i>.</li>
                              <li>Baixe o XML de metadados do Identity Provider ou copie o certificado X.509.</li>
                            </ol>
                          </div>

                          <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                            <p className="font-semibold text-text-main flex items-center gap-1.5">
                              <span>🛡️</span> Keycloak / Authentik
                            </p>
                            <ol className="list-decimal pl-4 text-text-muted space-y-1">
                              <li>Clients → <b>Create client</b> → Selecione <b>SAML</b>.</li>
                              <li><b>Client ID:</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:9router:sp"}</code></li>
                              <li><b>Master SAML Processing URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                              <li>Exporte o XML do SAML Descriptor ou copie o PEM do Certificado IDP.</li>
                            </ol>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick Import Card */}
                  <div className="p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm text-text-main">Importação 1-Click de Metadados XML IdP</p>
                      <p className="text-xs text-text-muted">Preenchimento automático de URL SSO, Emissor & Certificado a partir de metadados XML</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      icon={<Upload className="size-4" />}
                      onClick={() => idpMetadataFileRef.current?.click()}
                    >
                      Carregar Metadados XML
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
                      <Label className="sm:text-base">URL do Serviço Single Sign-On (samlEntryPoint)</Label>
                      <Input
                        placeholder="https://idp.example.com/app/saml/sso/..."
                        value={samlForm.samlEntryPoint}
                        onChange={(e) => updateSamlForm("samlEntryPoint", e.target.value)}
                        disabled={loading || samlLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="sm:text-base">Entity ID do SP / Audience (samlIssuer)</Label>
                      <Input
                        placeholder="urn:9router:sp"
                        value={samlForm.samlIssuer}
                        onChange={(e) => updateSamlForm("samlIssuer", e.target.value)}
                        disabled={loading || samlLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="sm:text-base">Certificado X.509 do IdP (samlCert)</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          icon={<Upload className="size-4" />}
                          onClick={() => certFileRef.current?.click()}
                        >
                          Carregar Certificado
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
                      <p className="text-xs text-text-muted">Cole o certificado Base64 bruto ou bloco PEM.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label className="sm:text-base">Rótulo do Botão de Login</Label>
                        <Input
                          placeholder="Entrar com SAML SSO"
                          value={samlForm.samlLoginLabel}
                          onChange={(e) => updateSamlForm("samlLoginLabel", e.target.value)}
                          disabled={loading || samlLoading}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label className="sm:text-base">Atributo de Claim de E-mail</Label>
                        <Input
                          placeholder="email"
                          value={samlForm.samlAttributeEmail}
                          onChange={(e) => updateSamlForm("samlAttributeEmail", e.target.value)}
                          disabled={loading || samlLoading}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label className="sm:text-base">Claim de Nome de Exibição</Label>
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
                        <p className="font-medium text-text-main">URL de Callback ACS</p>
                        <code className="block break-all font-mono text-xs">{samlAcsUrl}</code>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        icon={<Copy className="size-4" />}
                        onClick={() => {
                          navigator.clipboard.writeText(samlAcsUrl);
                          setSamlStatus({ type: "success", message: "URL ACS copiada para a área de transferência!" });
                        }}
                      >
                        Copiar
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
                      <div>
                        <p className="font-medium text-text-main">Metadados XML do SP</p>
                        <code className="block break-all font-mono text-xs">{samlMetadataUrl}</code>
                      </div>
                      <a
                        href={samlMetadataUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download="9router-sp-metadata.xml"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <Download className="size-4" />
                        Baixar XML
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/50">
                    <Button
                      type="button"
                      variant="primary"
                      loading={samlLoading}
                      onClick={() => saveSamlSettings(oidcForm.authMode)}
                      className="w-full sm:w-auto"
                    >
                      Salvar configurações SAML
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      loading={samlTestLoading}
                      onClick={testSamlConnection}
                      className="w-full sm:w-auto"
                    >
                      Testar configurações SAML
                    </Button>
                  </div>

                  {samlTestStatus.message && (
                    <p className={`text-xs sm:text-sm ${samlTestStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
                      {samlTestStatus.message}
                    </p>
                  )}

                  {samlStatus.message && (
                    <p className={`text-xs sm:text-sm ${samlStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
                      {samlStatus.message}
                    </p>
                  )}
                </div>
              ) : (
                /* OIDC Panel */
                <div className="flex flex-col gap-4 pt-2 border-t border-border/50">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label className="sm:text-base">URL do Emissor</Label>
                      <Input
                        placeholder="https://auth.example.com/application/o/9router/"
                        value={oidcForm.oidcIssuerUrl}
                        onChange={(e) => updateOidcForm("oidcIssuerUrl", e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="sm:text-base">ID do Cliente</Label>
                      <Input
                        placeholder="9router-dashboard"
                        value={oidcForm.oidcClientId}
                        onChange={(e) => updateOidcForm("oidcClientId", e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="sm:text-base">Segredo do Cliente</Label>
                      <Input
                        type="password"
                        placeholder="Deixe em branco para manter o segredo existente"
                        value={oidcClientSecret}
                        onChange={(e) => setOidcClientSecret(e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                      <p className="text-xs sm:text-sm text-text-muted">Este valor é somente escrita após salvar.</p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="sm:text-base">Escopos</Label>
                      <Input
                        placeholder="openid profile email"
                        value={oidcForm.oidcScopes}
                        onChange={(e) => updateOidcForm("oidcScopes", e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="sm:text-base">Rótulo do Botão de Login</Label>
                      <Input
                        placeholder="Entrar com OIDC"
                        value={oidcForm.oidcLoginLabel}
                        onChange={(e) => updateOidcForm("oidcLoginLabel", e.target.value)}
                        disabled={loading || oidcLoading}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-3 text-xs sm:text-sm text-text-muted">
                    <p className="font-medium text-text-main mb-1">URI de Redirecionamento</p>
                    <code className="block break-all font-mono">{oidcRedirectUri}</code>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/50">
                    <Button type="button" variant="primary" loading={oidcLoading} onClick={() => saveOidcSettings()} className="w-full sm:w-auto">
                      Salvar configurações OIDC
                    </Button>
                    <Button type="button" variant="outline" loading={oidcTestLoading} onClick={testOidcConnection} className="w-full sm:w-auto">
                      Testar conexão
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
              )}

              {settings.authMode === "oidc" || settings.authMode === "saml" || settings.authMode === "sso" ? (
                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
                  Login SSO ({settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"}) está ativo no momento. Login por senha está desabilitado até você mudar de volta.
                </p>
              ) : null}

              {settings.authMode === "both" && (
                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
                  Login por senha e SSO ({settings.ssoType === "saml" ? "SAML 2.0" : "OIDC"}) estão ambos ativos.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Routing Preferences */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
              <Route className="size-5" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Estratégia de Roteamento</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">Round Robin</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Alternar entre contas para distribuir a carga
                </p>
              </div>
              <Switch
                checked={settings.fallbackStrategy === "round-robin"}
                onCheckedChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")}
                disabled={loading}
              />
            </div>

            {/* Sticky Round Robin Limit */}
            {settings.fallbackStrategy === "round-robin" && (
              <div className="flex items-start sm:items-center justify-between gap-4 pt-2 border-t border-border/50">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm sm:text-base">Limite Sticky</p>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Chamadas por conta antes de alternar
                  </p>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.stickyRoundRobinLimit || 3}
                  onChange={(e) => updateStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-16 sm:w-20 text-center shrink-0"
                />
              </div>
            )}

            {/* Combo Round Robin */}
            <div className="flex items-start sm:items-center justify-between gap-4 pt-4 border-t border-border/50">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">Round Robin de Combo</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Alternar entre provedores nos combos em vez de sempre começar com o primeiro
                </p>
              </div>
              <Switch
                checked={settings.comboStrategy === "round-robin"}
                onCheckedChange={() => updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")}
                disabled={loading}
              />
            </div>

            {/* Combo Sticky Round Robin Limit */}
            {settings.comboStrategy === "round-robin" && (
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div>
                  <p className="font-medium">Limite Sticky de Combo</p>
                  <p className="text-sm text-text-muted">
                    Chamadas por modelo de combo antes de alternar
                  </p>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.comboStickyRoundRobinLimit || 1}
                  onChange={(e) => updateComboStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-20 text-center"
                />
              </div>
            )}

            <p className="text-xs text-text-muted italic pt-2 border-t border-border/50">
              {settings.fallbackStrategy === "round-robin"
                ? `Atualmente distribuindo requisições entre todas as contas disponíveis com ${settings.stickyRoundRobinLimit || 3} chamadas por conta.`
                : "Atualmente usando contas em ordem de prioridade (Preencher Primeiro)."}
              {settings.comboStrategy === "round-robin"
                ? ` Combos rotacionam após ${settings.comboStickyRoundRobinLimit || 1} chamada${(settings.comboStickyRoundRobinLimit || 1) === 1 ? "" : "s"} por modelo.`
                : " Combos sempre começam com seu primeiro modelo."}
            </p>
          </div>
        </Card>

        {/* Network */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
              <Wifi className="size-5" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Rede</h3>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">Proxy de Saída</p>
                <p className="text-xs sm:text-sm text-text-muted">Habilitar proxy para requisições de saída OAuth + provedor.</p>
              </div>
              <Switch
                checked={settings.outboundProxyEnabled === true}
                onCheckedChange={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))}
                disabled={loading || proxyLoading}
              />
            </div>

            {settings.outboundProxyEnabled === true && (
              <form onSubmit={updateOutboundProxy} className="flex flex-col gap-4 pt-2 border-t border-border/50">
                <div className="flex flex-col gap-2">
                  <Label className="sm:text-base">URL do Proxy</Label>
                  <Input
                    placeholder="http://127.0.0.1:7897"
                    value={proxyForm.outboundProxyUrl}
                    onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundProxyUrl: e.target.value }))}
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-xs sm:text-sm text-text-muted">Deixe vazio para herdar o proxy de ambiente existente (se houver).</p>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
                  <Label className="sm:text-base">Sem Proxy</Label>
                  <Input
                    placeholder="localhost,127.0.0.1"
                    value={proxyForm.outboundNoProxy}
                    onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundNoProxy: e.target.value }))}
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-xs sm:text-sm text-text-muted">Nomes de host/domínios separados por vírgula para ignorar o proxy.</p>
                </div>

                <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    loading={proxyTestLoading}
                    disabled={loading || proxyLoading}
                    onClick={testOutboundProxy}
                    className="w-full sm:w-auto"
                  >
                    Testar URL do proxy
                  </Button>
                  <Button type="submit" variant="primary" loading={proxyLoading} className="w-full sm:w-auto">
                    Aplicar
                  </Button>
                </div>
              </form>
            )}

            {proxyStatus.message && (
              <p className={`text-xs sm:text-sm ${proxyStatus.type === "error" ? "text-red-500" : "text-green-500"} pt-2 border-t border-border/50`}>
                {proxyStatus.message}
              </p>
            )}
          </div>
        </Card>

        {/* Observability Settings */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 shrink-0">
              <BarChart3 className="size-5" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Observabilidade</h3>
          </div>
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base">Habilitar Observabilidade</p>
              <p className="text-xs sm:text-sm text-text-muted">
                Registrar detalhes das requisições para inspeção na visualização de logs
              </p>
            </div>
            <Switch
              checked={observabilityEnabled}
              onCheckedChange={updateObservabilityEnabled}
              disabled={loading}
            />
          </div>
        </Card>

        {/* Account actions */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            fullWidth
            icon={<LogOut className="size-4" />}
            onClick={handleLogout}
          >
            Sair
          </Button>
        </div>

        {/* App Info */}
        <div className="text-center text-xs sm:text-sm text-text-muted py-4">
          <p>{APP_CONFIG.name} v{APP_CONFIG.version}</p>
          <p className="mt-1">Modo Local - Todos os dados armazenados na sua máquina</p>
        </div>
      </div>

      <LanguageSwitcher
        hideTrigger
        isOpen={langOpen}
        onClose={(next?: string) => {
          setLangOpen(false);
          if (next) setLocale(normalizeLocale(next));
        }}
      />
      <Modal
        isOpen={dbAuth.open}
        onClose={() => setDbAuth({ open: false, mode: "", password: "" })}
        title="Confirmar Senha"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDbAuth({ open: false, mode: "", password: "" })} disabled={dbLoading}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleDbAuthConfirm} loading={dbLoading} disabled={!dbAuth.password}>
              Confirmar
            </Button>
          </>
        }
      >
        <p className="text-text-muted mb-3 text-sm">
          Digite sua senha atual para {dbAuth.mode === "export" ? "exportar" : "importar"} o banco de dados.
        </p>
        <Input
          type="password"
          value={dbAuth.password}
          onChange={(e) => setDbAuth((s) => ({ ...s, password: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter" && dbAuth.password) handleDbAuthConfirm(); }}
          placeholder="Senha atual"
          autoFocus
        />
      </Modal>
    </div>
  );
}
