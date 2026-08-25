// Rewrite Antigravity IDE markers so upstream AG 2.x backend accepts the request.
// User-Agent header (antigravity/<old>) and body.metadata.ideVersion are forced
// to a known-good IDE version. Hardcoded MVP — toggle/version configurable later.

export const ANTIGRAVITY_IDE_VERSION: string = "1.23.2";
const ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED: boolean = true;

interface IdeMetadata {
  ideName?: string;
  ideType?: string;
  ideVersion?: string;
  [key: string]: unknown;
}

interface AntigravityBody {
  metadata?: IdeMetadata;
  [key: string]: unknown;
}

interface VersionOverrideResult {
  bodyBuffer: Buffer;
  headers: Record<string, string | string[] | undefined>;
  applied: boolean;
  version: string;
}

function shouldRewriteMetadata(metadata: unknown): metadata is IdeMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const m = metadata as IdeMetadata;
  if (String(m.ideName || "").toLowerCase() === "antigravity") return true;
  if (String(m.ideType || "").toUpperCase() === "ANTIGRAVITY") return true;
  return Object.prototype.hasOwnProperty.call(m, "ideVersion");
}

function rewriteAntigravityUserAgent(userAgent: string | undefined, version: string): string | undefined {
  if (typeof userAgent !== "string" || !userAgent.includes("antigravity/")) return userAgent;
  return userAgent.replace(/antigravity\/[^\s]+/, `antigravity/${version}`);
}

function applyAntigravityIdeVersionOverride(
  bodyBuffer: Buffer,
  headers: Record<string, string | string[] | undefined>
): VersionOverrideResult {
  if (!ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED) {
    return { bodyBuffer, headers, applied: false, version: ANTIGRAVITY_IDE_VERSION };
  }

  const nextHeaders: Record<string, string | string[] | undefined> = { ...headers };
  const nextUserAgent = rewriteAntigravityUserAgent(nextHeaders["user-agent"] as string | undefined, ANTIGRAVITY_IDE_VERSION);
  const userAgentChanged = nextUserAgent !== nextHeaders["user-agent"];
  if (userAgentChanged) nextHeaders["user-agent"] = nextUserAgent;

  try {
    const parsed: AntigravityBody = JSON.parse(bodyBuffer.toString());
    if (!shouldRewriteMetadata(parsed?.metadata)) {
      return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version: ANTIGRAVITY_IDE_VERSION };
    }

    parsed.metadata!.ideVersion = ANTIGRAVITY_IDE_VERSION;
    const nextBodyBuffer: Buffer = Buffer.from(JSON.stringify(parsed));
    return { bodyBuffer: nextBodyBuffer, headers: nextHeaders, applied: true, version: ANTIGRAVITY_IDE_VERSION };
  } catch {
    return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version: ANTIGRAVITY_IDE_VERSION };
  }
}

export { applyAntigravityIdeVersionOverride, rewriteAntigravityUserAgent };
