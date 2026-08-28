import { DefaultExecutor } from "./default";
import type { Credentials } from "../services/types";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model: string, body: Record<string, unknown>, stream?: boolean, credentials?: Credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials) as Record<string, unknown>;
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages as Record<string, unknown>[] : [];
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role as string)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        (transformed.messages as Record<string, unknown>[]).push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        (transformed.messages as Record<string, unknown>[]).push({ ...message });
      }
    }

    return transformed;
  }
}

export default CodeBuddyIntlExecutor;
