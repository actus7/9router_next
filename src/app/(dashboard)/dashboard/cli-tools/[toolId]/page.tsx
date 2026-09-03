import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getMachineId } from "@/shared/utils/machine";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import ToolDetailClient from "./ToolDetailClient";

interface ToolDetailPageProps {
  params: Promise<{ toolId: string }>;
}

export async function generateMetadata({ params }: ToolDetailPageProps): Promise<Metadata> {
  const { toolId } = await params;
  const tool = (CLI_TOOLS as Record<string, { name: string }>)[toolId];
  if (!tool) return { title: "Tool Not Found | ModelHub" };
  return {
    title: `${tool.name} | ModelHub`,
    description: `Configure ${tool.name} CLI tool`,
  };
}

export default async function ToolDetailPage({ params }: ToolDetailPageProps) {
  await assertRequestRuntime();
  const { toolId } = await params;
  if (!(CLI_TOOLS as Record<string, unknown>)[toolId]) notFound();
  const machineId = await getMachineId();
  return <ToolDetailClient toolId={toolId} machineId={machineId} />;
}
