import fs from "fs";
import path from "path";
import zlib from "zlib";
import { DATA_DIR } from "./paths";
import { LOG_BLACKLIST_URL_PARTS } from "./config";
import type { IncomingMessage } from "http";

function time(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const log = (msg: string): void => console.log(`[${time()}] [MITM] ${msg}`);
const err = (msg: string): void => console.error(`[${time()}] ❌ [MITM] ${msg}`);

const DUMP_DIR: string = path.join(DATA_DIR, "logs", "mitm");
if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true });

// Clear all files inside DUMP_DIR (called on MITM server start to avoid unbounded growth)
function clearDumpDir(): void {
  try {
    if (!fs.existsSync(DUMP_DIR)) return;
    for (const f of fs.readdirSync(DUMP_DIR)) {
      try { fs.rmSync(path.join(DUMP_DIR, f), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

const EMPTY_BODY_RE: RegExp = /^\s*(\{\s*\}|\[\s*\]|null)?\s*$/;

function slugify(s: string, max: number = 80): string {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_").substring(0, max);
}

function isBlacklisted(url: string | undefined): boolean {
  if (!url) return false;
  return LOG_BLACKLIST_URL_PARTS.some((part: string) => url.includes(part));
}

// Decode body buffer based on content-encoding header
function decodeBody(buf: Buffer, encoding: string | undefined): Buffer {
  if (!buf || buf.length === 0) return buf;
  try {
    const enc: string = (encoding || "").toLowerCase();
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch { /* return raw on failure */ }
  return buf;
}

interface ResponseDumper {
  writeHeader: (status: number, headers: Record<string, string | string[] | undefined>) => void;
  writeChunk: (chunk: Buffer | string | null | undefined) => void;
  end: () => void;
  file: string;
}

// Save raw request: method + url + headers + body
function dumpRequest(req: IncomingMessage, bodyBuffer: Buffer, tag: string = "raw"): string | null {
  if (isBlacklisted(req.url)) return null;
  try {
    const ts: string = new Date().toISOString().replace(/[:.]/g, "-");
    const slug: string = slugify((req.headers.host || "") + (req.url || ""));
    const file: string = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.req.json`);
    let parsed: unknown = null;
    try { parsed = JSON.parse(bodyBuffer.toString()); } catch { /* not JSON */ }
    fs.writeFileSync(file, JSON.stringify({
      method: req.method,
      url: req.url,
      host: req.headers.host,
      headers: req.headers,
      body: parsed ?? bodyBuffer.toString("utf8")
    }, null, 2));
    return file;
  } catch { return null; }
}

// Buffer-based response dumper — collects chunks then decodes + writes once on end()
// Trade-off: holds response in RAM, but enables gzip/br decoding for readable output.
function createResponseDumper(req: IncomingMessage, tag: string = "raw"): ResponseDumper | null {
  if (isBlacklisted(req.url)) return null;
  const ts: string = new Date().toISOString().replace(/[:.]/g, "-");
  const slug: string = slugify((req.headers.host || "") + (req.url || ""));
  const file: string = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.res.txt`);
  let status: number = 0;
  let headers: Record<string, string | string[] | undefined> = {};
  const chunks: Buffer[] = [];
  return {
    writeHeader: (s: number, h: Record<string, string | string[] | undefined>): void => { status = s; headers = h || {}; },
    writeChunk: (chunk: Buffer | string | null | undefined): void => {
      if (chunk == null) return;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    end: (): void => {
      try {
        const raw: Buffer = Buffer.concat(chunks);
        const enc: string | string[] | undefined = headers["content-encoding"] || headers["Content-Encoding"];
        const decoded: Buffer = decodeBody(raw, enc as string | undefined);
        const text: string = decoded.toString("utf8");
        // Skip empty / trivially-empty bodies
        if (EMPTY_BODY_RE.test(text)) return;
        // Strip content-encoding since body is now decoded
        const cleanHeaders: Record<string, string | string[] | undefined> = { ...headers };
        delete cleanHeaders["content-encoding"];
        delete cleanHeaders["Content-Encoding"];
        const out: string = `STATUS: ${status}\nHEADERS: ${JSON.stringify(cleanHeaders, null, 2)}\n---BODY---\n${text}`;
        fs.writeFileSync(file, out);
      } catch { /* ignore */ }
    },
    file
  };
}

export { log, err };
