// Logger utility for cloud

interface LogLevels {
  DEBUG: number;
  INFO: number;
  WARN: number;
  ERROR: number;
}

const LOG_LEVELS: LogLevels = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const LEVEL: number = LOG_LEVELS[(process.env.LOG_LEVEL?.toUpperCase?.() as keyof LogLevels) ?? "INFO"] ?? LOG_LEVELS.INFO;

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// Colored-dot tags to correlate request lines by session (same session → same color)
const REQ_TAGS: string[] = ["🟢", "🔵", "🟣", "🟡", "🟠", "🔴", "⚪", "🟤"];
let tagCursor: number = 0;

// Allocate next rotating tag (fallback when no session seed available)
function nextTag(): string {
  const tag: string = REQ_TAGS[tagCursor % REQ_TAGS.length];
  tagCursor++;
  return tag;
}

// Stable tag derived from a session/connection seed: same seed always maps to the same color
function tagForSession(seed: string | null | undefined): string {
  if (!seed) return nextTag();
  let h: number = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return REQ_TAGS[Math.abs(h) % REQ_TAGS.length];
}

// Print one correlated line: [time] tag symbol message
function line(tag: string, symbol: string, message: string): void {
  if (LEVEL > LOG_LEVELS.INFO) return;
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

// Like line() but always printed regardless of LOG_LEVEL (errors must never be hidden)
function errorLine(tag: string, symbol: string, message: string): void {
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

interface ThinkIntent {
  mode: string;
  budget?: number;
  level?: string;
}

// Format thinking intent for the request line ("high(10k)" / "off" / "auto")
function fmtThink(intent: ThinkIntent | null | undefined): string | null {
  if (!intent || !intent.mode) return null;
  if (intent.mode === "none") return "off";
  if (intent.mode === "auto") return "auto";
  if (intent.mode === "budget") {
    const k: string = intent.budget! >= 1000 ? `${Math.round(intent.budget! / 1000)}k` : `${intent.budget}`;
    return k;
  }
  if (intent.mode === "level") return intent.level!;
  return null;
}

function formatData(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function debug(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    const dataStr: string = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] 🔍 [${tag}] ${message}${dataStr}`);
  }
}

export function info(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const dataStr: string = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ℹ️  [${tag}] ${message}${dataStr}`);
  }
}

export function warn(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.WARN) {
    const dataStr: string = data ? ` ${formatData(data)}` : "";
    console.warn(`[${formatTime()}] ⚠️  [${tag}] ${message}${dataStr}`);
  }
}

export function error(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    const dataStr: string = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ❌ [${tag}] ${message}${dataStr}`);
  }
}

export function request(method: string, path: string, extra?: unknown): void {
  const dataStr: string = extra ? ` ${formatData(extra)}` : "";
  console.log(`\x1b[36m[${formatTime()}] 📥 ${method} ${path}${dataStr}\x1b[0m`);
}

function response(status: number, duration: number, extra?: unknown): void {
  const icon: string = status < 400 ? "📤" : "💥";
  const dataStr: string = extra ? ` ${formatData(extra)}` : "";
  console.log(`[${formatTime()}] ${icon} ${status} (${duration}ms)${dataStr}`);
}

function stream(event: string, data?: unknown): void {
  const dataStr: string = data ? ` ${formatData(data)}` : "";
  console.log(`[${formatTime()}] 🌊 [STREAM] ${event}${dataStr}`);
}

// Mask sensitive data
export function maskKey(key: string | null | undefined): string {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
