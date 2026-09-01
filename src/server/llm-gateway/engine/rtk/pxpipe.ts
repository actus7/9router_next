// PXPIPE: render bulky Claude-format context as dense PNGs via pxpipe-proxy's
// library API (transformAnthropicMessages). Fail-open like every token saver:
// any error/timeout returns { body: null, summary } and leaves the request untouched.
import { FORMATS } from "../translator/formats";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MIN_CHARS = 25000;
// pxpipe's own profitability gate assumes ~4 chars/token; reuse it for the
// estimated before/after numbers surfaced in stats (marked "estimated" in UI).
const EST_CHARS_PER_TOKEN = 4;

function bodyChars(body: unknown) {
  try {
    return JSON.stringify(body)?.length || 0;
  } catch {
    return 0;
  }
}

function estTokens(chars: number) {
  return Math.round(chars / EST_CHARS_PER_TOKEN);
}

function skipped(reason: string, extra: Record<string, unknown> = {}) {
  return { body: null, summary: { applied: false, reason, ...extra } };
}

interface PxpipeSummary {
  applied: boolean;
  reason: string;
  originalChars?: number;
  compressedBodyChars?: number;
  imagedChars?: number;
  imageCount?: number;
  imageBytes?: number;
  tokensBeforeEst?: number;
  tokensAfterEst?: number;
  tokensSavedEst?: number;
  savedPct?: number;
  durationMs?: number;
  cacheOwnsControl?: boolean;
}

// Transform a Claude-format request body through pxpipe. Returns
// { body: <new body object> | null, summary } — body is null when nothing changed.
// opts.transform is injected by the host (src side) so open-sse stays free of
// filesystem/install concerns and remains usable standalone.
export async function compressWithPxpipe(body: unknown, { enabled, format, model, minChars, timeoutMs, transform }: { enabled?: boolean; format?: string; model?: string; minChars?: number; timeoutMs?: number; transform?: (opts: unknown) => Promise<unknown> } = {}) {
  if (!enabled) return skipped("disabled");
  if (typeof transform !== "function") return skipped("not_installed");
  if (!body) return skipped("missing_body");
  if (format !== FORMATS.CLAUDE) return skipped("unsupported_format", { detail: format });

  const startedAt = Date.now();
  const originalChars = bodyChars(body);
  const threshold = Number(minChars) > 0 ? Number(minChars) : DEFAULT_MIN_CHARS;
  if (originalChars < threshold) {
    return skipped("below_threshold", { originalChars, threshold });
  }

  try {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    // transformAnthropicMessages is local CPU work and can't be aborted; race a
    // timer and discard the result if it loses (input body is never mutated).
    const result = await Promise.race([
      transform({
        body: encoded,
        model,
        options: { minCompressChars: threshold },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), budget)),
    ]) as Record<string, unknown> | null;
    if (!result) return skipped("timeout", { originalChars, durationMs: Date.now() - startedAt });
    if (!result.applied) {
      return skipped((result.reason as string) || "passthrough", {
        detail: result.detail,
        originalChars,
        durationMs: Date.now() - startedAt,
      });
    }

    const newBody = JSON.parse(new TextDecoder().decode(result.body as Uint8Array));
    const compressedBodyChars = bodyChars(newBody);
    const info = (result.info as Record<string, unknown>) || {};
    const imagedChars = (info.compressedChars as number) || 0;
    // The transformed body is BIGGER in bytes (base64 PNGs) but cheaper in tokens:
    // images bill by pixels (Anthropic: pixels/750), not by encoded length. So the
    // after-estimate is remaining-text tokens + image tokens — never chars/4 of the
    // new body. Provider-billed usage recorded per request stays the ground truth.
    const imageTokensEst = (info.imageTokens as number)
      || (info.imagePixels ? Math.round((info.imagePixels as number) / 750) : ((info.imageCount as number) || 0) * 4761);
    const summary: PxpipeSummary = {
      applied: true,
      reason: "applied",
      originalChars,
      compressedBodyChars,
      imagedChars,
      imageCount: (info.imageCount as number) || 0,
      imageBytes: (info.imageBytes as number) || 0,
      tokensBeforeEst: (info.baselineTokens as number) || estTokens(originalChars),
      tokensAfterEst: estTokens(Math.max(0, originalChars - imagedChars)) + imageTokensEst,
      durationMs: Date.now() - startedAt,
      cacheOwnsControl: (result.cache as Record<string, unknown>)?.ownsCacheControl === true,
    };
    summary.tokensSavedEst = Math.max(0, (summary.tokensBeforeEst || 0) - (summary.tokensAfterEst || 0));
    summary.savedPct = (summary.tokensBeforeEst || 0) > 0
      ? +(((summary.tokensSavedEst || 0) / (summary.tokensBeforeEst || 1)) * 100).toFixed(2)
      : 0;
    return { body: newBody, summary };
  } catch (e: unknown) {
    return skipped("transform_error", { detail: e instanceof Error ? e.message : String(e), originalChars, durationMs: Date.now() - startedAt });
  }
}
