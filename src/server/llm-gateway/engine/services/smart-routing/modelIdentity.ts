/**
 * Model identity for the suggestion board. Pure string work, no I/O:
 *
 * - `canonicalModelKey`: one key for the same model however a provider spells
 *   it ("xiaomi/mimo-v2.5-pro:free" and "MiMo-V2.5-Pro"), so the board can cap
 *   how many copies of one model a lane holds.
 * - `modelFamily`: family words + numeric version ("gemini pro" 3.1), so an
 *   older generation can give way to a newer one of the same family and size.
 * - `isChatModel`: the name-level filter for models a provider files as `llm`
 *   that are not chat models (music, video, speech, translation, research
 *   agents) — the provider's service kind alone let Lyria into a chat lane.
 */

// Words that mark a release channel, not a different model.
const NOISE_WORDS = new Set(["preview", "latest", "exp", "experimental", "beta", "free"]);
// Reasoning-effort configurations of one model ("gemini-3.1-pro-low"): the
// same family for comparison. "max" is deliberately absent — it names products
// (Qwen Max, Fugu Max).
const EFFORT_WORDS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

/** Size/speed variants of a family: smaller siblings, never its flagship. */
export const SMALL_VARIANT_PATTERN = /(^|[^a-z])(flash|flashx|mini|nano|lite|small|haiku|luna|turbo|instant|highspeed|lightning|fast|air)([^a-z]|$)/;
/** Names a family's top tier ("deepseek-v4-pro", "qwen3.8-max", "claude-opus-5"). */
export const FLAGSHIP_PATTERN = /(^|[^a-z])(pro|max|ultra|opus|sonnet|sol|terra|plus|large)([^a-z]|$)/;

// Any of these tokens in an id means the model is not a chat model.
const NON_CHAT_TOKENS = new Set([
  "lyria", "veo", "imagen", "image", "images", "dalle", "dall", "flux", "sdxl", "sora", "kling", "video", "music",
  "tts", "speech", "whisper", "transcribe", "transcription", "audio",
  "embed", "embedding", "embeddings", "rerank", "reranker", "moderation",
]);

/** The last path segment, lower-cased, without a `:free`-style tag. */
function bareId(id: string): string {
  const last = String(id ?? "").toLowerCase().split("/").pop() ?? "";
  return last.split(":")[0];
}

type Token = { kind: "word"; value: string } | { kind: "version"; value: number[] } | { kind: "date"; value: number };

/**
 * "qwen3.8-max-0902" → word qwen, version 3.8, word max, date 902. Short
 * numeric runs merge into one version ("claude-opus-4-8" → 4.8); a 4/6/8-digit
 * run after the version is a dated snapshot, and everything numeric after a
 * date belongs to it ("o1-2024-12-17").
 */
function tokenize(id: string): Token[] {
  const raw = bareId(id).split(/[-_\s]+/).filter(Boolean);
  const split: string[] = [];
  for (const part of raw) {
    // "qwen3.8" / "v2.6" / "m2.7": letters glued to a version number.
    const glued = /^([a-z]+)(\d+(?:\.\d+)*)$/.exec(part);
    if (glued) {
      if (glued[1] !== "v") split.push(glued[1]);
      split.push(glued[2]);
    } else {
      split.push(part);
    }
  }
  const tokens: Token[] = [];
  let sawDate = false;
  for (const part of split) {
    if (/^\d+(?:\.\d+)*$/.test(part)) {
      const isDate = /^\d{4}$|^\d{6}$|^\d{8}$/.test(part);
      if (sawDate || (isDate && tokens.some((token) => token.kind === "version"))) {
        if (!sawDate) tokens.push({ kind: "date", value: Number(part) });
        sawDate = true;
        continue;
      }
      const numbers = part.split(".").map(Number);
      const previous = tokens[tokens.length - 1];
      // "4" then "8" → 4.8, but only for short components ("gpt-5-6" style).
      if (previous?.kind === "version" && part.length <= 2 && !part.includes(".")) {
        previous.value = [...previous.value, ...numbers];
      } else {
        tokens.push({ kind: "version", value: numbers });
      }
      continue;
    }
    if (!NOISE_WORDS.has(part)) tokens.push({ kind: "word", value: part.replace(/[^a-z0-9]/g, "") });
  }
  return tokens.filter((token) => token.kind !== "word" || token.value);
}

/** One key per model across providers, spellings, free tags and dated snapshots. */
export function canonicalModelKey(id: string): string {
  return tokenize(id)
    .filter((token) => token.kind !== "date")
    .map((token) => (token.kind === "version" ? token.value.join(".") : token.value))
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

export interface ModelFamily {
  /** Family and size words in order ("gemini pro", "mimo flash"). */
  family: string;
  /** Version components, a dated snapshot appended last. */
  version: number[];
}

/** Family + version, or null when the id carries no version to compare. */
export function modelFamily(id: string): ModelFamily | null {
  const tokens = tokenize(id);
  const versionIndex = tokens.findIndex((token) => token.kind === "version");
  if (versionIndex < 0) return null;
  const version = [...(tokens[versionIndex].value as number[])];
  const date = tokens.find((token) => token.kind === "date");
  if (date) version.push(date.value as number);
  const family = tokens
    .filter((token): token is Extract<Token, { kind: "word" }> => token.kind === "word" && !EFFORT_WORDS.has(token.value))
    .map((token) => token.value)
    .join(" ");
  return family ? { family, version } : null;
}

/** Numeric, component-wise; a missing component counts as lower ("3" < "3.1"). */
export function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? -1;
    const right = b[index] ?? -1;
    if (left !== right) return left - right;
  }
  return 0;
}

/** False for models filed as `llm` that are not chat models. */
export function isChatModel(id: string): boolean {
  const tokens = String(id ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (NON_CHAT_TOKENS.has(token)) return false;
    // Translation models: "hunyuan-mt2-pro", "Hy-MT2-Pro".
    if (/^mt\d*$/.test(token)) return false;
    if (token === "deepresearch" || (token === "deep" && tokens[index + 1] === "research")) return false;
  }
  return true;
}
