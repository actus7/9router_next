import { Suspense } from "react";
import { getCombos, getProviders, getSettings, getModelAliases } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import CombosClient from "./CombosClient";

export default async function CombosPage() {
  const [combos, providers, settings, aliases] = await Promise.all([
    getCombos(),
    getProviders(),
    getSettings(),
    getModelAliases(),
  ]);

  return (
    <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}>
      <CombosClient
        initialCombos={combos}
        initialProviders={providers}
        initialSettings={settings}
        initialAliases={aliases}
      />
    </Suspense>
  );
}
