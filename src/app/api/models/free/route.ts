import { NextResponse } from "next/server";
import { safePublicFetch } from "@/server/security/safeFetch";
import { FREE_PROVIDERS } from "@/shared/constants/providers";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "@/server/llm-gateway/catalog";

export const dynamic = "force-dynamic";

interface FreeModelGroup {
  providerId: string;
  providerName: string;
  models: Array<{ id: string; name: string }>;
}

type RemoteModel = { id?: unknown; name?: unknown };

function isChatModelId(modelId: string): boolean {
  return !/(?:^|[-_/])(asr|audio|embed(?:ding)?|image|rerank|speech|stt|tts|vision|whisper)(?:[-_/]|$)/i.test(modelId);
}

export function parseRemoteModels(payload: unknown): Array<{ id: string; name: string }> {
  const record = payload as Record<string, unknown>;
  const candidates = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(record?.models)
      ? record.models
      : [];

  return candidates
    .map((candidate) => {
      const model = candidate as RemoteModel;
      const id = typeof model?.id === "string" ? model.id.trim() : "";
      return { id, name: typeof model?.name === "string" ? model.name : id };
    })
    .filter((model) => model.id.length > 0 && isChatModelId(model.id));
}

/**
 * Some shared endpoints (notably OpenCode Zen) list paid models before their
 * free catalogue. Apply the provider's eligibility rule before imposing the
 * UI cap, otherwise all free entries can be lost from the first page.
 */
export function filterDiscoveredNoAuthModels(
  models: Array<{ id: string; name: string }>,
  fetcherType: string,
): Array<{ id: string; name: string }> {
  const eligible = fetcherType === "opencode-free"
    ? models.filter((model) => model.id.endsWith("-free") || model.id === "big-pickle")
    : fetcherType === "mimo-free"
      ? models.filter((model) => model.id.startsWith("mimo") || model.name.toLowerCase().includes("mimo"))
      : models;

  return eligible.slice(0, 12);
}

async function discoverNoAuthModels(provider: Record<string, unknown>, alias: string): Promise<Array<{ id: string; name: string }>> {
  const fetcher = provider.modelsFetcher as Record<string, unknown> | undefined;
  const url = typeof fetcher?.url === "string" ? fetcher.url : "";
  if (url) {
    try {
      const transportHeaders = ((provider.transport as Record<string, unknown> | undefined)?.headers || {}) as Record<string, string>;
      const response = await safePublicFetch(url, {
        headers: { Accept: "application/json", ...transportHeaders },
        timeoutMs: 8_000,
      });
      if (response.ok) {
        const discovered = filterDiscoveredNoAuthModels(
          parseRemoteModels(await response.json()),
          typeof fetcher?.type === "string" ? fetcher.type : "",
        );
        if (discovered.length > 0) return discovered;
      }
    } catch {
      // Use the shipped model list when live discovery is temporarily unavailable.
    }
  }

  return getProviderModels(alias)
    .filter((model) => String(model.kind || model.type || "llm") === "llm")
    .map((model) => ({ id: String(model.id), name: String(model.name || model.id) }));
}

/**
 * GET /api/models/free
 * No-auth ("free" category) providers never have a connection row — this
 * lists their static catalog models directly so chat can offer them without
 * requiring the user to add a connection first.
 */
export async function GET(): Promise<NextResponse> {
  const groups: FreeModelGroup[] = [];

  for (const provider of Object.values(FREE_PROVIDERS)) {
    if (provider.noAuth !== true) continue;
    const serviceKinds = Array.isArray(provider.serviceKinds) ? provider.serviceKinds : [];
    if (serviceKinds.length > 0 && !serviceKinds.includes("llm")) continue;
    const providerId = String(provider.id || "");
    if (!providerId) continue;
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const models = await discoverNoAuthModels(provider, alias);
    if (models.length === 0) continue;
    groups.push({
      providerId,
      providerName: String(provider.name || providerId),
      models: models.map((m) => ({ id: `${alias}/${m.id}`, name: String(m.name || m.id) })),
    });
  }

  return NextResponse.json({ groups });
}
