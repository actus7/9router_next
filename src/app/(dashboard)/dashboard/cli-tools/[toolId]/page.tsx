// @ts-nocheck
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getMachineId } from "@/shared/utils/machine";
import ToolDetailClient from "./ToolDetailClient";

interface ToolDetailPageProps {
  params: Promise<{ toolId: string }>;
}

export async function generateMetadata({ params }: ToolDetailPageProps): Promise<Metadata> {
  const { toolId } = await params;
  const tool = CLI_TOOLS[toolId];
  if (!tool) return { title: "Tool Not Found | 9Router" };
  return {
    title: `${tool.name} | 9Router`,
    description: `Configure ${tool.name} CLI tool`,
  };
}

export default async function ToolDetailPage({ params }: ToolDetailPageProps) {
  const { toolId } = await params;
  if (!CLI_TOOLS[toolId]) notFound();
  const machineId = await getMachineId();
  return <ToolDetailClient toolId={toolId} machineId={machineId} />;
}
