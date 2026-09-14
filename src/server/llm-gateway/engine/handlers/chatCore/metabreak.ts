import { METABREAK_PROFILE } from "../../config/metabreak";
import { FORMATS } from "../../translator/formats";
import { ROLE, OPENAI_BLOCK } from "../../translator/schema";
import { injectSystemPrompt } from "../../rtk/systemInject";

type Result = { applied: boolean; reason: string };
const skip = (reason: string): Result => ({ applied: false, reason });
const applied = (): Result => ({ applied: true, reason: "operating-profile-v6" });
const append = (text: string) => text ? `${text}\n\n${METABREAK_PROFILE}` : METABREAK_PROFILE;
const containsProfile = (value: unknown): boolean => typeof value === "string"
  ? value.includes(METABREAK_PROFILE)
  : Array.isArray(value) && value.some(part => typeof part?.text === "string" && part.text.includes(METABREAK_PROFILE));

/** Adds fixed operating instructions, preserving native tools, reasoning and output contracts. */
export function applyMetaBreak(body: Record<string, unknown>, format: string): Result {
  if (!body || typeof body !== "object") return skip("invalid-body");

  switch (format) {
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
    case FORMATS.CODEX: {
      if (typeof body.input !== "string" && !Array.isArray(body.input)) return skip("missing-input");
      if (body.instructions != null && typeof body.instructions !== "string") return skip("invalid-instructions");
      if (containsProfile(body.instructions)) return skip("already-applied");
      body.instructions = append((body.instructions as string | null) ?? "");
      return applied();
    }
    case FORMATS.CLAUDE: {
      if (!Array.isArray(body.messages)) return skip("missing-messages");
      if (body.system != null && typeof body.system !== "string" && !Array.isArray(body.system)) return skip("invalid-system");
      if (containsProfile(body.system)) return skip("already-applied");
      // Reuse cache-aware injection without modifying arrays owned by the caller.
      const next = { ...body, system: Array.isArray(body.system) ? [...body.system] : body.system };
      injectSystemPrompt(next, format, METABREAK_PROFILE);
      body.system = next.system;
      return applied();
    }
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY: {
      const wrapped = body.request != null;
      if (wrapped && (typeof body.request !== "object" || Array.isArray(body.request))) return skip("invalid-request");
      const target = (wrapped ? body.request : body) as Record<string, unknown>;
      if (!Array.isArray(target.contents)) return skip("missing-contents");
      const key = Object.hasOwn(target, "system_instruction") ? "system_instruction" : "systemInstruction";
      const system = target[key] as { parts?: unknown[] } | null | undefined;
      if (system != null && (typeof system !== "object" || !Array.isArray(system.parts))) return skip("invalid-system");
      if (containsProfile(system?.parts)) return skip("already-applied");
      const next = { ...target, [key]: system ? { ...system, parts: [...system.parts!] } : undefined };
      injectSystemPrompt(next, FORMATS.GEMINI, METABREAK_PROFILE);
      if (wrapped) body.request = next;
      else body[key] = next[key];
      return applied();
    }
    case FORMATS.OPENAI:
    case FORMATS.CURSOR:
    case FORMATS.OLLAMA:
    case FORMATS.COMMANDCODE: {
      if (!Array.isArray(body.messages)) return skip("missing-messages");
      const messages = [...body.messages];
      const index = messages.findIndex(message => message && (message.role === ROLE.SYSTEM || message.role === ROLE.DEVELOPER));
      if (index < 0) {
        messages.unshift({ role: ROLE.SYSTEM, content: METABREAK_PROFILE });
      } else {
        const original = messages[index];
        if (original.content != null && typeof original.content !== "string" && !Array.isArray(original.content)) return skip("invalid-system");
        if (containsProfile(original.content)) return skip("already-applied");
        messages[index] = { ...original, content: Array.isArray(original.content)
          ? [...original.content, { type: OPENAI_BLOCK.TEXT, text: METABREAK_PROFILE }]
          : append(original.content ?? "") };
      }
      body.messages = messages;
      return applied();
    }
    default:
      return skip("unsupported-format");
  }
}
