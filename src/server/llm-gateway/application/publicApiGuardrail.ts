// The public API's opt-in content guardrail, kept out of `chat.ts` (the
// architecture gate caps that file): user messages are scanned for prompt
// injection before any routing or model spend.

import { hasVerifiedGatewayKey } from "./gatewayApiKey";
import { currentGatewayProfile } from "./gatewayProfile";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { scanUntrustedContent } from "@/server/decisions/guardrails";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import * as log from "../utils/logger";

// Below this a Jev "injection" verdict is not worth blocking a real user's
// turn over: a false positive costs more than a miss.
const GUARDRAIL_BLOCK_PROBABILITY = 0.85;

/** The text of one user message: string content, or its text parts joined. */
function userMessageText(message: unknown): string {
  const record = message as { role?: unknown; content?: unknown } | null;
  if (!record || record.role !== "user") return "";
  const content = record.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : part && typeof part === "object" && (part as { type?: unknown }).type === "text"
          ? String((part as { text?: unknown }).text ?? "")
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

function guardrailBlockResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { message: "Request blocked by content guardrail", type: "invalid_request_error", code: "content_guardrail" },
    }),
    { status: HTTP_STATUS.BAD_REQUEST, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Opt-in content guardrail, public API-key path only (`gatewayRoute` — see
 * `hasVerifiedGatewayKey`): the in-process harness pipeline is not scanned
 * here, its tool results are scanned where that pipeline builds them.
 *
 * On when `settings.guardrailsPublicApi` or the key profile's `guardrails`
 * flag says so. Off means zero cost — no message is even read for scanning.
 * Each user message's text is scanned for injection; a Jev verdict at >= 0.85
 * probability answers 400 before any model is spent. Heuristic-only findings
 * carry no probability and never block. Fail-open end to end: a scan that
 * cannot run lets the request through. The streamed output is deliberately
 * not scanned here — that would be one scan per chunk and latency on every
 * token.
 */
export async function enforcePublicApiGuardrail(body: { messages?: unknown }): Promise<Response | null> {
  try {
    if (!hasVerifiedGatewayKey()) return null;
    const settings = await getSettings();
    const profile = (await currentGatewayProfile()) as { guardrails?: boolean } | null | undefined;
    if (!settings.guardrailsPublicApi && profile?.guardrails !== true) return null;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const message of messages) {
      const text = userMessageText(message);
      if (!text.trim()) continue;
      const scan = await scanUntrustedContent(text, "user_input");
      for (const issue of scan.issues) {
        if (issue.code === "injection" && (issue.probability ?? 0) >= GUARDRAIL_BLOCK_PROBABILITY) {
          log.warn("GUARD", "Blocked request: user message looks like a prompt injection");
          return guardrailBlockResponse();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
