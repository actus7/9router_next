import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getComboById, getSettings, getProviders, getApiKeys, getModelAliases, getUsageLogs } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import ComboDetailClient from "./ComboDetailClient";

async function ComboDetailContent({ params }: Pick<PageProps<"/dashboard/media-providers/combo/[id]">, "params">) {
  await assertRequestRuntime();
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
    <ComboDetailClient
        comboId={id}
        initialCombo={combo as unknown as { id: string; name: string; kind?: string; models: string[] }}
        initialSettings={settings as unknown as Record<string, unknown>}
        initialProviders={providers as unknown as Record<string, unknown>[]}
        initialKeys={keys as unknown as Record<string, unknown>[]}
        initialAliases={aliases as unknown as Record<string, unknown>}
        initialLogs={logs as unknown[]}
    />
  );
}

export default function ComboDetailPage(props: PageProps<"/dashboard/media-providers/combo/[id]">) {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ComboDetailContent {...props} /></Suspense>;
}
