import { notFound, redirect } from "next/navigation";
import { getComboById } from "@/lib/db/repos/combosRepo";
import { getProviders, getModelAliases } from "@/lib/data-access";
import { getDeterministicSmartProfiles } from "@/server/application/use-cases/smart-routing/getDeterministicProfiles";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import SmartComboClient from "./SmartComboClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SmartComboPage({ params }: PageProps) {
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
}
