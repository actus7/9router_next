import { NextResponse } from "next/server";
import { getDefaultModel, PROVIDERS, resolveQoderCredentials, resolveQoderModels } from "@/server/llm-gateway/catalog";
import { openaiToCommandCodeRequest } from "@/server/llm-gateway/translator";
import { providerValidateFetch } from "./providerValidateFetch";
import {
  validateByConfigUrl,
  validateGenericOpenAiCompatible,
  validateGlmFamily,
  validateVertexKey,
} from "./validateFamilies";

export async function validateProviderKey(
  provider: string,
  apiKey: string,
  providerSpecificData: Record<string, unknown> | undefined,
): Promise<{ isValid: boolean; error: string | null } | NextResponse> {
  switch (provider) {
    case "openai": {
      const openaiRes = await providerValidateFetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      }, { providerId: provider });
      return { isValid: openaiRes.ok, error: null };
    }

    case "vercel-ai-gateway": {
      const vercelAiGatewayRes = await providerValidateFetch("https://ai-gateway.vercel.sh/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      }, { providerId: provider });
      return { isValid: vercelAiGatewayRes.ok, error: null };
    }

    case "anthropic": {
      const anthropicRes = await providerValidateFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      }, { providerId: provider });
      return { isValid: anthropicRes.status !== 401, error: null };
    }

    case "gemini": {
      const geminiRes = await providerValidateFetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`, {}, { providerId: provider });
      return { isValid: geminiRes.ok, error: null };
    }

    case "openrouter": {
      const openrouterRes = await providerValidateFetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      }, { providerId: provider });
      return { isValid: openrouterRes.ok, error: null };
    }

    case "glm":
    case "glm-cn":
    case "kimi":
    case "minimax":
    case "minimax-cn":
    case "alicode-intl":
    case "alims-intl":
    case "alicode":
    case "agentrouter":
      return { isValid: await validateGlmFamily(provider, apiKey), error: null };

    case "volcengine-ark":
    case "byteplus": {
      const res = await providerValidateFetch(PROVIDERS[provider]?.baseUrl as string, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: getDefaultModel(provider),
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      }, { providerId: provider });
      return { isValid: res.status !== 401 && res.status !== 403, error: null };
    }

    case "deepseek":
    case "groq":
    case "xai":
    case "mistral":
    case "perplexity":
    case "together":
    case "fireworks":
    case "cerebras":
    case "cohere":
    case "nebius":
    case "siliconflow":
    case "hyperbolic":
    case "ollama":
    case "assemblyai":
    case "nanobanana":
    case "chutes":
    case "xiaomi-mimo":
    case "xiaomi-tokenplan":
    case "nvidia":
      return { isValid: await validateByConfigUrl(provider, apiKey, providerSpecificData), error: null };

    case "opencode-go": {
      const res = await providerValidateFetch("https://opencode.ai/zen/go/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: getDefaultModel("opencode-go"),
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
      }, { providerId: provider });
      return { isValid: res.status !== 401 && res.status !== 403, error: null };
    }

    case "commandcode": {
      const cfg = PROVIDERS.commandcode;
      const model = getDefaultModel("commandcode");
      const payload = openaiToCommandCodeRequest(model as string, {
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }, false);
      const res = await providerValidateFetch(cfg.baseUrl as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.headers || {}),
          "x-session-id": crypto.randomUUID(),
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      }, { providerId: provider });
      return { isValid: res.status !== 401 && res.status !== 403, error: null };
    }

    case "deepgram": {
      const res = await providerValidateFetch("https://api.deepgram.com/v1/projects", {
        headers: { "Authorization": `Token ${apiKey}` },
      }, { providerId: provider });
      return { isValid: res.ok, error: null };
    }

    case "blackbox": {
      const res = await providerValidateFetch("https://api.blackbox.ai/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      }, { providerId: provider });
      // Returns 401 for invalid key, 200 for valid, 400 for malformed
      return { isValid: res.status === 200 || res.status === 400, error: null };
    }

    case "vertex":
    case "vertex-partner":
      return { isValid: await validateVertexKey(apiKey), error: null };

    case "qoder": {
      // PAT (pt-...) needs the job-token exchange before it can sign
      // anything — the generic OpenAI-compat probe below can't validate it.
      try {
        const resolved = await resolveQoderCredentials({ apiKey, providerSpecificData }, null, AbortSignal.timeout(8000));
        const result = await resolveQoderModels(resolved, { forceRefresh: true });
        return { isValid: !!result?.models?.length, error: null };
      } catch (err) {
        return { isValid: false, error: (err as Error).message };
      }
    }

    default: {
      const generic = await validateGenericOpenAiCompatible(provider, apiKey);
      if (generic instanceof NextResponse) return generic;
      return { isValid: generic, error: null };
    }
  }
}
