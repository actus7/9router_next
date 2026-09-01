import { createHash } from "node:crypto";
import { DefaultExecutor } from "./default";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { dbg } from "../utils/debugLog";
import type { Logger } from "../services/types";

/**
 * ModelScopeExecutor — extends DefaultExecutor with custom credential validation.
 *
 * ModelScope's GET /v1/models returns 200 for ANY token (including garbage),
 * so the default validateUrl-based validation would mark invalid keys healthy
 * forever. Instead, we validate with a real 1-token chat probe.
 *
 * Successful validations are cached per key for 24h to avoid burning the
 * account's 魔粒 (magic-grain) quota — one probe costs ~2 魔粒.
 */

const VALIDATE_CACHE_MS = 24 * 60 * 60 * 1000; // 24h
const VALIDATE_TIMEOUT_MS = 30_000;

/** key hash → last successful validation timestamp */
const validationCache = new Map<string, number>();

function cacheKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export class ModelScopeExecutor extends DefaultExecutor {
  constructor() {
    super("modelscope");
  }

  /**
   * Validate a ModelScope API key by making a real 1-token chat completion.
   * GET /v1/models is useless for validation (returns 200 for garbage tokens).
   *
   * Returns true if the key is valid, false if auth failed (401/403),
   * or throws on transport errors (DNS/timeout/TLS → health status='error').
   */
  async validateCredential(apiKey: string, _log?: Logger): Promise<boolean> {
    const key = cacheKey(apiKey);
    const now = Date.now();

    // Check cache: a key validated within 24h is trusted without re-probing
    const lastValidated = validationCache.get(key);
    if (lastValidated !== undefined && now - lastValidated < VALIDATE_CACHE_MS) {
      dbg("MODELSCOPE", `validateCredential cache hit for key hash ${key.slice(0, 8)}...`);
      return true;
    }

    const baseUrl = "https://api-inference.modelscope.cn/v1";

    // Step 1: fetch models roster to pick a live model id for the probe
    const modelsRes = await proxyAwareFetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    }, null);

    if (!modelsRes.ok) {
      // Auth failures cannot happen here (endpoint is unauthenticated);
      // treat any non-200 as an upstream outage → throw (health status='error')
      throw new Error(`ModelScope /models returned HTTP ${modelsRes.status} while picking a validation probe model`);
    }

    const roster = (await modelsRes.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
    const probeModel = roster?.data?.[0]?.id;
    if (!probeModel) {
      throw new Error("ModelScope /models returned no models to probe key validity against");
    }

    // Step 2: the actual auth check — a minimal 1-token completion
    const chatRes = await proxyAwareFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: probeModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    }, null);

    // 401/403 → invalid key; everything else (200, 400, 404, 429) proves
    // the token authenticated
    if (chatRes.status === 401 || chatRes.status === 403) {
      const errBody = await chatRes.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (errBody?.error as Record<string, unknown>)?.message as string || `HTTP ${chatRes.status}`;
      dbg("MODELSCOPE", `validateCredential FAILED: ${errMsg}`);
      return false;
    }

    // Success: cache the validation
    dbg("MODELSCOPE", `validateCredential OK for key hash ${key.slice(0, 8)}..., caching for 24h`);
    validationCache.set(key, now);
    return true;
  }
}

export default ModelScopeExecutor;
