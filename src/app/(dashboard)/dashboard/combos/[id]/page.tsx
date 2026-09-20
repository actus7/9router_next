import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getComboById } from "@/lib/db/repos/combosRepo";
import { getProviders, getModelAliases } from "@/lib/data-access";
import { getDeterministicSmartProfiles } from "@/server/application/use-cases/smart-routing/getDeterministicProfiles";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { withTenantPage } from "@/server/application/http/withTenantPage";
import { Spinner } from "@/shared/components/Loading";
import SmartComboClient from "./SmartComboClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

async function SmartComboContent({ params }: { params: Promise<{ id: string }> }) {
  return withTenantPage(async () => {
    await assertRequestRuntime();
    const { id } = await params;
    const [combo, providers, aliases, profiles] = await Promise.all([
      getComboById(id),
      getProviders(),
      getModelAliases(),
      getDeterministicSmartProfiles(),
    ]);
    if (!combo) notFound();
    if (combo.kind !== "smart") redirect("/dashboard/combos");

    return (
      <SmartComboClient
        initialCombo={{ ...combo, models: combo.models.filter((model): model is string => typeof model === "string") }}
        activeProviders={providers}
        modelAliases={aliases}
        initialProfiles={profiles}
      />
    );
  });
}

export default function SmartComboPage({ params }: PageProps<"/dashboard/combos/[id]">) {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><SmartComboContent params={params} /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
