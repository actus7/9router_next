import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getMachineId } from "@/shared/utils/machine";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { Spinner } from "@/shared/components/Loading";
import ToolDetailClient from "./ToolDetailClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export async function generateMetadata({ params }: PageProps<"/dashboard/cli-tools/[toolId]">): Promise<Metadata> {
  const { toolId } = await params;
  const tool = (CLI_TOOLS as Record<string, { name: string }>)[toolId];
  if (!tool) return { title: "Tool Not Found | ModelHub" };
  return {
    title: `${tool.name} | ModelHub`,
    description: `Configure ${tool.name} CLI tool`,
  };
}

async function ToolDetailContent({ params }: { params: Promise<{ toolId: string }> }) {
  await assertRequestRuntime();
  const { toolId } = await params;
  if (!(CLI_TOOLS as Record<string, unknown>)[toolId]) notFound();
  const machineId = await getMachineId();
  return <ToolDetailClient toolId={toolId} machineId={machineId} />;
}

export default function ToolDetailPage({ params }: PageProps<"/dashboard/cli-tools/[toolId]">) {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ToolDetailContent params={params} /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
