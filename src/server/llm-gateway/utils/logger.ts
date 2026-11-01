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

// Print one correlated line: [time] tag symbol message
export function line(tag: string, symbol: string, message: string): void {
  if (LEVEL > LOG_LEVELS.INFO) return;
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

// Like line() but always printed regardless of LOG_LEVEL (errors must never be hidden)
export function errorLine(tag: string, symbol: string, message: string): void {
  console.error(`[${formatTime()}] ${tag} ${symbol} ${message}`);
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
    console.error(`[${formatTime()}] ❌ [${tag}] ${message}${dataStr}`);
  }
}

export function request(method: string, path: string, extra?: unknown): void {
  const dataStr: string = extra ? ` ${formatData(extra)}` : "";
  console.log(`\x1b[36m[${formatTime()}] 📥 ${method} ${path}${dataStr}\x1b[0m`);
}



// Mask sensitive data
export function maskKey(key: string | null | undefined): string {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
