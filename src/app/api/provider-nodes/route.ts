import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse } from "next/server";
import { createProviderNode, getProviderNodes } from "@/models";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX, CUSTOM_EMBEDDING_PREFIX } from "@/shared/constants/providers";
import { generateId } from "@/shared/utils";
import { assertProviderEndpointAllowed } from "@/server/security/providerEndpoint";


const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

const CUSTOM_EMBEDDING_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

// GET /api/provider-nodes - List all provider nodes
async function handleGET(): Promise<NextResponse> {
  try {
    const nodes = await getProviderNodes();
    return NextResponse.json({ nodes });
  } catch (error) {
    console.error("Error fetching provider nodes:", error);
    return NextResponse.json({ error: "Failed to fetch provider nodes" }, { status: 500 });
  }
}

// POST /api/provider-nodes - Create provider node
async function handlePOST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, type } = (body ?? {}) as Record<string, unknown>;

    // Typed before trimmed: `{"name":123}` used to reach `name.trim()` and come
    // back as a 500 instead of a 400.
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (typeof prefix !== "string" || !prefix.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }
    if (baseUrl !== undefined && baseUrl !== null && typeof baseUrl !== "string") {
      return NextResponse.json({ error: "Base URL must be a string" }, { status: 400 });
    }
    const rawBaseUrl: string | undefined = typeof baseUrl === "string" ? baseUrl : undefined;

    /**
     * The node's base URL becomes the inference target for every connection
     * under it, fetched with the server's own network position. It used to be
     * stored with no validation at all — not even a URL parse — so an account
     * could point one at the cloud metadata service and read the response out
     * of the gateway's upstream error. Checked here, at the write, so the
     * operator gets a 400 while configuring rather than a surprise at runtime.
     */
    const requireAllowedBaseUrl = (candidate: string): NextResponse | null => {
      try {
        assertProviderEndpointAllowed(candidate);
        return null;
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
      }
    };

    // Determine type
    const nodeType = type || "openai-compatible";

    if (nodeType === "openai-compatible") {
      if (typeof apiType !== "string" || !["chat", "responses"].includes(apiType)) {
        return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
      }

      const resolvedBaseUrl = (rawBaseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl).trim();
      const blocked = requireAllowedBaseUrl(resolvedBaseUrl);
      if (blocked) return blocked;

      const node = await createProviderNode({
        id: `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${generateId()}`,
        type: "openai-compatible",
        prefix: prefix.trim(),
        apiType,
        baseUrl: resolvedBaseUrl,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "custom-embedding") {
      // Strip trailing slash and /embeddings if user pasted full endpoint
      let sanitizedBaseUrl = (rawBaseUrl || CUSTOM_EMBEDDING_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }

      const blocked = requireAllowedBaseUrl(sanitizedBaseUrl);
      if (blocked) return blocked;

      const node = await createProviderNode({
        id: `${CUSTOM_EMBEDDING_PREFIX}${generateId()}`,
        type: "custom-embedding",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "anthropic-compatible") {
      // Sanitize Base URL: remove trailing slash, and remove trailing /messages if user added it
      // This prevents double-appending /messages at runtime
      let sanitizedBaseUrl = (rawBaseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }

      const blocked = requireAllowedBaseUrl(sanitizedBaseUrl);
      if (blocked) return blocked;

      const node = await createProviderNode({
        id: `${ANTHROPIC_COMPATIBLE_PREFIX}${generateId()}`,
        type: "anthropic-compatible",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid provider node type" }, { status: 400 });
  } catch (error) {
    console.error("Error creating provider node:", error);
    return NextResponse.json({ error: "Failed to create provider node" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
export const POST = tenantRoute(handlePOST);
