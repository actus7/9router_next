import { Suspense } from "react";
import { getCombos, getProviders, getSettings, getModelAliases } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import CombosClient from "./CombosClient";

async function CombosContent() {
  const [combos, providers, settings, aliases] = await Promise.all([
    getCombos(),
    getProviders(),
    getSettings(),
    getModelAliases(),
  ]);

  return (
    <CombosClient
        initialCombos={combos}
        initialProviders={providers}
        initialSettings={settings}
        initialAliases={aliases}
    />
  );
}

export default function CombosPage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><CombosContent /></Suspense>;
}
