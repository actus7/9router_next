// Check if running in Node.js environment (has fs module)
const isNode = typeof process !== "undefined" && process.versions?.node && typeof window === "undefined";

// Check if logging is enabled via environment variable (default: false)
const LOGGING_ENABLED = typeof process !== "undefined" && process.env?.ENABLE_REQUEST_LOGS === 'true';

let fs: typeof import("fs") | null = null;
let path: typeof import("path") | null = null;
let LOGS_DIR: string | null = null;

// Lazy load Node.js modules (avoid top-level await)
async function ensureNodeModules() {
  if (!isNode || !LOGGING_ENABLED || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
    LOGS_DIR = path.join(typeof process !== "undefined" && process.cwd ? process.cwd() : ".", "logs");
  } catch {
    // Running in non-Node environment (Worker, Browser, etc.)
  }
}

// Format timestamp for folder name: 20251228_143045_123
function formatTimestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

// Create log session folder: {sourceFormat}_{targetFormat}_{model}_{timestamp}
async function createLogSession(sourceFormat: string, targetFormat: string, model: string) {
  await ensureNodeModules();
  if (!fs || !LOGS_DIR) return null;
  
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    
    const timestamp = formatTimestamp();
    const safeModel = (model || "unknown").replace(/[/:]/g, "-");
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}`;
    const sessionPath = path!.join(LOGS_DIR, folderName);
    
    fs.mkdirSync(sessionPath, { recursive: true });
    
    return sessionPath;
  } catch (err: unknown) { console.error("[LOG] Failed to create log session:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Write JSON file
function writeJsonFile(sessionPath: string, filename: string, data: unknown) {
  if (!fs || !sessionPath) return;
  
  try {
    const filePath = path!.join(sessionPath, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err: unknown) { console.error(`[LOG] Failed to write ${filename}:`, err instanceof Error ? err.message : String(err));
  }
}

// Mask sensitive data in headers (DISABLED - keep full token for testing)
function maskSensitiveHeaders(headers: Record<string, string> | null | undefined) {
  if (!headers) return {};
  return { ...headers };
  
  // Old masking code (disabled):
  // const masked = { ...headers };
  // const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token"];
  // 
  // for (const key of Object.keys(masked)) {
  //   const lowerKey = key.toLowerCase();
  //   if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
  //     const value = masked[key];
  //     if (value && value.length > 20) {
  //       masked[key] = value.slice(0, 10) + "..." + value.slice(-5);
  //     }
  //   }
  // }
  // return masked;
}

/**
 * What a request logger offers its callers. Declared with method syntax on
 * purpose: bivariant parameters let the real logger keep its narrower argument
 * types without every call site needing a cast.
 */
export interface RequestLogger {
  readonly sessionPath: string | null;
  logClientRawRequest(endpoint?: string, body?: unknown, headers?: Record<string, string>): void;
  logRawRequest(body?: unknown, headers?: Record<string, string>): void;
  logOpenAIRequest(body?: unknown): void;
  logTargetRequest(url?: string, headers?: Record<string, string>, body?: unknown): void;
  logProviderResponse(status?: unknown, statusText?: unknown, headers?: unknown, body?: unknown): void;
  appendProviderChunk(chunk?: string): void;
  appendOpenAIChunk(chunk?: string): void;
  logConvertedResponse(body?: unknown): void;
  appendConvertedChunk(chunk?: string): void;
  logError(error?: unknown, requestBody?: unknown): void;
}

// No-op logger when logging is disabled
function createNoOpLogger(): RequestLogger {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {}
  };
}

/**
 * Create a new log session and return logger functions
 * @param {string} sourceFormat - Source format from client (claude, openai, etc.)
 * @param {string} targetFormat - Target format to provider (antigravity, gemini-cli, etc.)
 * @param {string} model - Model name
 * @returns {Promise<object>} Promise that resolves to logger object with methods to log each stage
 */
export async function createRequestLogger(sourceFormat: string, targetFormat: string, model: string): Promise<RequestLogger> {
  // Return no-op logger if logging is disabled
  if (!LOGGING_ENABLED) {
    return createNoOpLogger();
  }
  
  // Wait for session to be created before returning logger
  const sessionPath = await createLogSession(sourceFormat, targetFormat, model);
  
  return {
    get sessionPath() { return sessionPath; },
    
    // 1. Log client raw request (before any conversion)
    logClientRawRequest(endpoint: string, body: unknown, headers: Record<string, string> = {}) {
      writeJsonFile(sessionPath!, "1_req_client.json", {
        timestamp: new Date().toISOString(),
        endpoint,
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 2. Log raw request from client (after initial conversion like responsesApi)
    logRawRequest(body: unknown, headers: Record<string, string> = {}) {
      writeJsonFile(sessionPath!, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 3. Log OpenAI intermediate format (source → openai)
    logOpenAIRequest(body: unknown) {
      writeJsonFile(sessionPath!, "3_req_openai.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    // 4. Log target format request (openai → target)
    logTargetRequest(url: string, headers: Record<string, string>, body: unknown) {
      writeJsonFile(sessionPath!, "4_req_target.json", {
        timestamp: new Date().toISOString(),
        url,
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 5. Log provider response (for non-streaming or error)
    logProviderResponse(status: unknown, statusText: unknown, headers: unknown, body: unknown) {
      const filename = "5_res_provider.json";
      writeJsonFile(sessionPath!, filename, {
        timestamp: new Date().toISOString(),
        status,
        statusText,
        headers: headers ? (typeof (headers as Record<string, unknown>).entries === "function" ? Object.fromEntries((headers as Headers).entries()) : headers) : {},
        body
      });
    },
    
    // 5. Append streaming chunk to provider response
    appendProviderChunk(chunk: string) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path!.join(sessionPath, "5_res_provider.txt");
        fs.appendFileSync(filePath, chunk);
      } catch  {
        // Ignore append errors
      }
    },
    
    // 6. Append OpenAI intermediate chunks (target → openai)
    appendOpenAIChunk(chunk: string) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path!.join(sessionPath, "6_res_openai.txt");
        fs.appendFileSync(filePath, chunk);
      } catch  {
        // Ignore append errors
      }
    },
    
    // 7. Log converted response to client (for non-streaming)
    logConvertedResponse(body: unknown) {
      writeJsonFile(sessionPath!, "7_res_client.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    // 7. Append streaming chunk to converted response
    appendConvertedChunk(chunk: string) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path!.join(sessionPath, "7_res_client.txt");
        fs.appendFileSync(filePath, chunk);
      } catch  {
        // Ignore append errors
      }
    },
    
    // 6. Log error
    logError(error: unknown, requestBody: unknown = null) {
      writeJsonFile(sessionPath!, "6_error.json", {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        requestBody
      });
    }
  };
}

// Legacy functions for backward compatibility
