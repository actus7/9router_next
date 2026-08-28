import { ROLE } from "../schema/index";

// Build OpenAI delta carrying reasoning_content (optional leading assistant role)
export function reasoningDelta(text: string, withRole = false): Record<string, unknown> {
  return withRole
    ? { role: ROLE.ASSISTANT, reasoning_content: text }
    : { reasoning_content: text };
}

// Extract reasoning text from a streamed OpenAI-compatible delta across vendor shapes:
//   - reasoning_content (GLM, Qwen, DeepSeek, Kimi, Step, Hunyuan)
//   - reasoning (some compat layers)
//   - reasoning_details[] (MiniMax reasoning_split=true): [{ text|content }]
// Returns concatenated reasoning string, or "" when none.
export function extractReasoningText(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const d = delta as Record<string, unknown>;
  if (typeof d.reasoning_content === "string" && d.reasoning_content) return d.reasoning_content;
  if (typeof d.reasoning === "string" && d.reasoning) return d.reasoning;
  const details = d.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d: unknown) => (typeof d === "string" ? d : (d as Record<string, unknown>)?.text || (d as Record<string, unknown>)?.content || "")).join("");
  }
  return "";
}
