import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getComboById, getSettings, getProviders, getApiKeys, getModelAliases, getUsageLogs } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import ComboDetailClient from "./ComboDetailClient";

export default async function ComboDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [combo, settings, providers, keys, aliases, logs] = await Promise.all([
    getComboById(id),
    getSettings(),
    getProviders(),
    getApiKeys(),
    getModelAliases(),
    getUsageLogs({}),
  ]);

  if (!combo) {
    notFound();
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}>
      <ComboDetailClient
        comboId={id}
        initialCombo={combo as unknown as { id: string; name: string; kind?: string; models: string[] }}
        initialSettings={settings as unknown as Record<string, unknown>}
        initialProviders={providers as unknown as Record<string, unknown>[]}
        initialKeys={keys as unknown as Record<string, unknown>[]}
        initialAliases={aliases as unknown as Record<string, unknown>}
        initialLogs={logs as unknown[]}
      />
    </Suspense>
  );
}
