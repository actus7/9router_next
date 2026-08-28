// Strip multimodal content blocks a model cannot read, BEFORE translation.
// Driven by getCapabilitiesForModel: vision/audioInput/pdf. Replaces removed
// media with a short text placeholder so messages never become empty.
import { FORMATS } from "../formats";
import type { ModelCapabilities } from "./openaiTypes";

type CapabilityKey = "vision" | "audioInput" | "pdf";

// Placeholder text inserted where a media block was removed.
// Current turn: explain the active model can't read what the user just sent.
const PLACEHOLDER_CURRENT: Record<CapabilityKey, string> = {
  vision: "[image omitted: model has no vision support]",
  audioInput: "[audio omitted: model has no audio support]",
  pdf: "[file omitted: model has no document support]",
};
// Earlier turns: neutral (a combo may route to a different model each turn).
const PLACEHOLDER_PREV: Record<CapabilityKey, string> = {
  vision: "[Previous image omitted from context.]",
  audioInput: "[Previous audio omitted from context.]",
  pdf: "[Previous file omitted from context.]",
};
const ph = (cap: CapabilityKey, isLast: boolean): string => (isLast ? PLACEHOLDER_CURRENT : PLACEHOLDER_PREV)[cap];

// Map gemini inlineData/fileData mime prefix -> capability it requires.
function capForMime(mime: unknown): CapabilityKey | null {
  if (typeof mime !== "string") return null;
  if (mime.startsWith("image/")) return "vision";
  if (mime.startsWith("audio/")) return "audioInput";
  if (mime === "application/pdf") return "pdf";
  return null;
}

// OpenAI chat content block -> required capability (null = plain text/other, keep).
function capForOpenAIBlock(block: Record<string, unknown>): CapabilityKey | null {
  const t = block?.type as string;
  if (t === "image_url" || t === "image") return "vision";
  if (t === "input_audio" || t === "audio_url") return "audioInput";
  if (t === "file") return "pdf";
  return null;
}

// Claude content block -> required capability.
function capForClaudeBlock(block: Record<string, unknown>): CapabilityKey | null {
  const t = block?.type as string;
  if (t === "image") return "vision";
  if (t === "document") return "pdf";
  return null;
}

// Filter an array of content blocks; drop unsupported, inject one placeholder per kind.
// isLast = block belongs to the current user turn (picks the explanatory placeholder).
function filterBlocks(blocks: Record<string, unknown>[], capOf: (block: Record<string, unknown>) => CapabilityKey | null, caps: Record<string, unknown>, removed: Set<CapabilityKey>, isLast: boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const cap = capOf(block);
    if (cap && caps[cap] === false) { removed.add(cap); continue; }
    out.push(block);
  }
  for (const cap of removed) out.push({ type: "text", text: ph(cap, isLast) });
  return out;
}

// OpenAI / OpenAI-compatible chat messages[].content[].
function stripOpenAI(body: Record<string, unknown>, caps: Record<string, unknown>): void {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg: Record<string, unknown>, i: number) => {
    if (caps.vision === false) {
      if (Array.isArray(msg.images)) delete msg.images;
      if (Array.isArray(msg.experimental_attachments)) {
        msg.experimental_attachments = (msg.experimental_attachments as Record<string, unknown>[]).filter(
          (a: Record<string, unknown>) => !((typeof a?.contentType === "string" && a.contentType.startsWith("image/")) || (typeof a?.url === "string" && a.url.startsWith("data:image/")))
        );
      }
      if (Array.isArray(msg.attachments)) {
        msg.attachments = (msg.attachments as Record<string, unknown>[]).filter(
          (a: Record<string, unknown>) => !((typeof a?.contentType === "string" && a.contentType.startsWith("image/")) || (typeof a?.url === "string" && a.url.startsWith("data:image/")))
        );
      }
    }
    if (!Array.isArray(msg.content)) return;
    const removed = new Set<CapabilityKey>();
    msg.content = filterBlocks(msg.content as Record<string, unknown>[], capForOpenAIBlock, caps, removed, i === last);
  });
}

// Claude messages[].content[].
function stripClaude(body: Record<string, unknown>, caps: Record<string, unknown>): void {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg: Record<string, unknown>, i: number) => {
    if (!Array.isArray(msg.content)) return;
    const removed = new Set<CapabilityKey>();
    msg.content = filterBlocks(msg.content as Record<string, unknown>[], capForClaudeBlock, caps, removed, i === last);
  });
}

// OpenAI Responses input[].content[] (input_image / input_file).
function stripResponses(body: Record<string, unknown>, caps: Record<string, unknown>): void {
  if (!Array.isArray(body.input)) return;
  const last = body.input.length - 1;
  body.input.forEach((item: Record<string, unknown>, i: number) => {
    if (!Array.isArray(item.content)) return;
    const removed = new Set<CapabilityKey>();
    item.content = (item.content as Record<string, unknown>[]).filter((b: Record<string, unknown>) => {
      const cap: CapabilityKey | null = b?.type === "input_image" ? "vision" : b?.type === "input_file" ? "pdf" : null;
      if (cap && caps[cap] === false) { removed.add(cap); return false; }
      return true;
    });
    for (const cap of removed) (item.content as Record<string, unknown>[]).push({ type: "input_text", text: ph(cap, i === last) });
  });
}

// Gemini / gemini-cli contents[].parts[] (inlineData / fileData by mime).
function stripGeminiParts(contents: unknown, caps: Record<string, unknown>): void {
  if (!Array.isArray(contents)) return;
  const last = contents.length - 1;
  contents.forEach((c: Record<string, unknown>, i: number) => {
    if (!Array.isArray(c.parts)) return;
    const removed = new Set<CapabilityKey>();
    c.parts = (c.parts as Record<string, unknown>[]).filter((p: Record<string, unknown>) => {
      const mime = (p?.inlineData as Record<string, unknown>)?.mimeType || (p?.fileData as Record<string, unknown>)?.mimeType;
      const cap = capForMime(mime);
      if (cap && caps[cap] === false) { removed.add(cap); return false; }
      return true;
    });
    for (const cap of removed) (c.parts as Record<string, unknown>[]).push({ text: ph(cap, i === last) });
  });
}

/**
 * Remove media blocks the model can't read, in-place on the source-format body.
 * @param {object} body - request body (source format)
 * @param {string} sourceFormat - one of FORMATS
 * @param {object} caps - capabilities from getCapabilitiesForModel
 * @returns {boolean} true if anything was stripped-eligible (cap false for some modality)
 */
export function stripUnsupportedModalities(body: Record<string, unknown>, sourceFormat: string, caps: Record<string, unknown>): boolean {
  if (!body || !caps) return false;
  // Fast exit: model supports everything we'd strip.
  if (caps.vision !== false && caps.audioInput !== false && caps.pdf !== false) return false;

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      stripOpenAI(body, caps);
      break;
    case FORMATS.CLAUDE:
      stripClaude(body, caps);
      break;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
    case FORMATS.CODEX:
      stripResponses(body, caps);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      stripGeminiParts(body.contents, caps);
      break;
    case FORMATS.ANTIGRAVITY:
      stripGeminiParts((body?.request as Record<string, unknown>)?.contents, caps);
      break;
    default:
      stripOpenAI(body, caps);
  }
  return true;
}
