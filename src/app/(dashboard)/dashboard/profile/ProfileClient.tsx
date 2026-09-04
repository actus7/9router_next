"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormInput as Input } from "@/shared/components/FormInput";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import Modal from "@/shared/components/Modal";
import { useTheme } from "@/shared/hooks/useTheme";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { translate } from "@/i18n/runtime";
import { Button } from "@/components/ui/button";
import type { ProfileClientProps } from "./types";
import { useProfileSettings } from "./hooks/useProfileSettings";
import { usePasswordChange } from "./hooks/usePasswordChange";
import { useSsoConfig } from "./hooks/useSsoConfig";
import { useOutboundProxy } from "./hooks/useOutboundProxy";
import { useDatabaseBackup } from "./hooks/useDatabaseBackup";
import LocalModeCard from "./sections/LocalModeCard";
import LanguageCard from "./sections/LanguageCard";
import AccentColorCard from "./sections/AccentColorCard";
import SecurityCard from "./sections/SecurityCard";
import SsoCard from "./sections/SsoCard";
import RoutingCard from "./sections/RoutingCard";
import NetworkCard from "./sections/NetworkCard";
import ObservabilityCard from "./sections/ObservabilityCard";
import AccountActions from "./sections/AccountActions";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function ProfileClient({ initialSettings, initialDbInfo: _initialDbInfo }: ProfileClientProps) {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [locale, setLocale] = useState(() => getLocaleFromCookie());
  const [langOpen, setLangOpen] = useState(false);

  const profileSettings = useProfileSettings(initialSettings);
  const { settings, setSettings, loading, reloadSettings } = profileSettings;

  const passwordChange = usePasswordChange(settings);
  const ssoConfig = useSsoConfig(initialSettings, settings, setSettings);
  const outboundProxy = useOutboundProxy(initialSettings, settings, setSettings);
  const databaseBackup = useDatabaseBackup(settings, setSettings, reloadSettings);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.replace("/login");
      }
    } catch (err) {
      console.error("Falha ao sair:", err);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-6">
        <LocalModeCard
          theme={theme}
          setTheme={setTheme}
          isDark={isDark}
          dbLoading={databaseBackup.dbLoading}
          dbStatus={databaseBackup.dbStatus}
          dbAuth={databaseBackup.dbAuth}
          setDbAuth={databaseBackup.setDbAuth}
          importFileRef={databaseBackup.importFileRef}
          handleExportDatabase={databaseBackup.handleExportDatabase}
          handleImportDatabase={databaseBackup.handleImportDatabase}
          handleDbAuthConfirm={databaseBackup.handleDbAuthConfirm}
        />

        <LanguageCard locale={locale} setLangOpen={setLangOpen} />

        <AccentColorCard />

        <SecurityCard
          settings={settings}
          loading={loading}
          passwords={passwordChange.passwords}
          setPasswords={passwordChange.setPasswords}
          passStatus={passwordChange.passStatus}
          passLoading={passwordChange.passLoading}
          handlePasswordChange={passwordChange.handlePasswordChange}
          updateRequireLogin={profileSettings.updateRequireLogin}
        />

        <SsoCard
          settings={settings}
          loading={loading}
          oidcForm={ssoConfig.oidcForm}
          oidcClientSecret={ssoConfig.oidcClientSecret}
          setOidcClientSecret={ssoConfig.setOidcClientSecret}
          oidcStatus={ssoConfig.oidcStatus}
          oidcLoading={ssoConfig.oidcLoading}
          oidcTestLoading={ssoConfig.oidcTestLoading}
          oidcTestStatus={ssoConfig.oidcTestStatus}
          oidcExpanded={ssoConfig.oidcExpanded}
          setOidcExpanded={ssoConfig.setOidcExpanded}
          updateOidcForm={ssoConfig.updateOidcForm}
          saveOidcSettings={ssoConfig.saveOidcSettings}
          testOidcConnection={ssoConfig.testOidcConnection}
          oidcRedirectUri={ssoConfig.oidcRedirectUri}
          ssoTypeTab={ssoConfig.ssoTypeTab}
          setSsoTypeTab={ssoConfig.setSsoTypeTab}
          samlForm={ssoConfig.samlForm}
          samlStatus={ssoConfig.samlStatus}
          setSamlStatus={ssoConfig.setSamlStatus}
          samlLoading={ssoConfig.samlLoading}
          samlTestLoading={ssoConfig.samlTestLoading}
          samlTestStatus={ssoConfig.samlTestStatus}
          showSamlGuide={ssoConfig.showSamlGuide}
          setShowSamlGuide={ssoConfig.setShowSamlGuide}
          idpMetadataFileRef={ssoConfig.idpMetadataFileRef}
          certFileRef={ssoConfig.certFileRef}
          updateSamlForm={ssoConfig.updateSamlForm}
          handleIdpMetadataUpload={ssoConfig.handleIdpMetadataUpload}
          handleCertFileUpload={ssoConfig.handleCertFileUpload}
          saveSamlSettings={ssoConfig.saveSamlSettings}
          testSamlConnection={ssoConfig.testSamlConnection}
          samlAcsUrl={ssoConfig.samlAcsUrl}
          samlMetadataUrl={ssoConfig.samlMetadataUrl}
        />

        <RoutingCard
          settings={settings}
          loading={loading}
          updateFallbackStrategy={profileSettings.updateFallbackStrategy}
          updateComboStrategy={profileSettings.updateComboStrategy}
          updateStickyLimit={profileSettings.updateStickyLimit}
          updateComboStickyLimit={profileSettings.updateComboStickyLimit}
        />

        <NetworkCard
          settings={settings}
          loading={loading}
          proxyForm={outboundProxy.proxyForm}
          setProxyForm={outboundProxy.setProxyForm}
          proxyStatus={outboundProxy.proxyStatus}
          proxyLoading={outboundProxy.proxyLoading}
          proxyTestLoading={outboundProxy.proxyTestLoading}
          updateOutboundProxy={outboundProxy.updateOutboundProxy}
          testOutboundProxy={outboundProxy.testOutboundProxy}
          updateOutboundProxyEnabled={outboundProxy.updateOutboundProxyEnabled}
        />

        <ObservabilityCard
          observabilityEnabled={profileSettings.observabilityEnabled}
          loading={loading}
          updateObservabilityEnabled={profileSettings.updateObservabilityEnabled}
        />

        <AccountActions handleLogout={handleLogout} />
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
        isOpen={databaseBackup.dbAuth.open}
        onClose={() => databaseBackup.setDbAuth({ open: false, mode: "", password: "" })}
        title={translate("Confirm Password") || "Confirm Password"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => databaseBackup.setDbAuth({ open: false, mode: "", password: "" })} disabled={databaseBackup.dbLoading}>
              {translate("Cancel")}
            </Button>
            <Button variant="primary" onClick={databaseBackup.handleDbAuthConfirm} loading={databaseBackup.dbLoading} disabled={!databaseBackup.dbAuth.password}>
              {translate("Confirm")}
            </Button>
          </>
        }
      >
        <p className="text-text-muted mb-3 text-sm">
          {databaseBackup.dbAuth.mode === "export" ? translate("Enter your current password to export the database.") : translate("Enter your current password to import the database.")}
        </p>
        <Input
          type="password"
          value={databaseBackup.dbAuth.password}
          onChange={(e) => databaseBackup.setDbAuth((s) => ({ ...s, password: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter" && databaseBackup.dbAuth.password) databaseBackup.handleDbAuthConfirm(); }}
          placeholder={translate("Current password") || ""}
          autoFocus
        />
      </Modal>
    </div>
  );
}
