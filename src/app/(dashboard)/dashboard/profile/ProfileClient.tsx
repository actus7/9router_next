"use client";

import { authClient } from "@/lib/auth/client";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { useState } from "react";
import { useRouter } from "next/navigation";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import Modal from "@/shared/components/Modal";
import { useTheme } from "@/shared/hooks/useTheme";
import { normalizeLocale } from "@/i18n/config";
import { getCurrentLocale, translate } from "@/i18n/runtime";
import { Button } from "@/components/ui/button";
import type { ProfileClientProps } from "./types";
import { useProfileSettings } from "./hooks/useProfileSettings";
import { useOutboundProxy } from "./hooks/useOutboundProxy";
import { useDatabaseBackup } from "./hooks/useDatabaseBackup";
import AppearanceCard from "./sections/AppearanceCard";
import BackupCard from "./sections/BackupCard";
import LanguageCard from "./sections/LanguageCard";
import SecurityCard from "./sections/SecurityCard";
import RoutingCard from "./sections/RoutingCard";
import NetworkCard from "./sections/NetworkCard";
import AccountActions from "./sections/AccountActions";

export default function ProfileClient({ initialSettings, initialAccent }: ProfileClientProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  // Ler o cookie aqui dava "en" no SSR (sem `document`) e o valor real na
  // hidratação. `getCurrentLocale()` é o mesmo estado que todo `translate()`
  // desta tela já lê, semeado pelo servidor antes da hidratação — coincide nos
  // dois lados.
  const [locale, setLocale] = useState(getCurrentLocale);
  const [langOpen, setLangOpen] = useState(false);

  const profileSettings = useProfileSettings(initialSettings);
  const { settings, setSettings, loading, reloadSettings } = profileSettings;

  const outboundProxy = useOutboundProxy(initialSettings, settings, setSettings);
  const databaseBackup = useDatabaseBackup(reloadSettings);

  const handleLogout = async () => {
    try {
      await authClient.signOut();
      router.replace(SIGN_IN_PATH);
    } catch (err) {
      console.error("Falha ao sair:", err);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-6">
        <AppearanceCard theme={theme} setTheme={setTheme} initialAccent={initialAccent} />

        <BackupCard
          dbLoading={databaseBackup.dbLoading}
          dbStatus={databaseBackup.dbStatus}
          importFileRef={databaseBackup.importFileRef}
          handleExportDatabase={databaseBackup.handleExportDatabase}
          handleImportDatabase={databaseBackup.handleImportDatabase}
        />

        <LanguageCard locale={locale} setLangOpen={setLangOpen} />

        <SecurityCard />


        <RoutingCard
          settings={settings}
          loading={loading}
          updateFallbackStrategy={profileSettings.updateFallbackStrategy}
          updateComboStrategy={profileSettings.updateComboStrategy}
          updateStickyLimit={profileSettings.updateStickyLimit}
          updateComboStickyLimit={profileSettings.updateComboStickyLimit}
          updateFreeFallbackEnabled={profileSettings.updateFreeFallbackEnabled}
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
        isOpen={!!databaseBackup.pendingImport}
        onClose={() => databaseBackup.setPendingImport(null)}
        title={translate("Replace this account's data?") || "Replace this account's data?"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => databaseBackup.setPendingImport(null)} disabled={databaseBackup.dbLoading}>
              {translate("Cancel")}
            </Button>
            <Button variant="primary" onClick={databaseBackup.confirmImportDatabase} loading={databaseBackup.dbLoading}>
              {translate("Confirm")}
            </Button>
          </>
        }
      >
        <p className="text-text-muted text-sm">
          {translate("Importing a backup deletes this account's current providers, keys, combos and settings, then restores what the file contains.")}
        </p>
      </Modal>
    </div>
  );
}
