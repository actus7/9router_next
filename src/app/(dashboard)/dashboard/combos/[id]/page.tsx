import { notFound, redirect } from "next/navigation";
import { getComboById } from "@/lib/db/repos/combosRepo";
import { getProviders, getModelAliases } from "@/lib/data-access";
import SmartComboClient from "./SmartComboClient";
import { refreshDeterministicSmartProfiles } from "@/server/llm-gateway/smart-routing";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SmartComboPage({ params }: PageProps) {
  const { id } = await params;
  const [combo, providers, aliases, profiles] = await Promise.all([
    getComboById(id),
    getProviders(),
    getModelAliases(),
    refreshDeterministicSmartProfiles(),
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
}
