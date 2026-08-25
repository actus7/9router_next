import https from "https";
import http2 from "http2";
import tls from "tls";
import fs from "fs";
import path from "path";
import dns from "dns";
import { promisify } from "util";
import { execSync } from "child_process";
import { log, err, dumpRequest, createResponseDumper, clearDumpDir } from "./logger";
import { IS_DEV, LSOF_BIN, TARGET_HOSTS, URL_PATTERNS, MODEL_SYNONYMS, MODEL_PATTERNS, MODEL_NO_MAP, getToolForHost, isChatRequest, extractModel } from "./config";
import { DATA_DIR, MITM_DIR } from "./paths";
import { generateCert, getCertForDomain } from "./cert/generate";
import { getMitmAlias } from "./dbReader";
import { applyAntigravityIdeVersionOverride } from "./antigravityIdeVersion";
import { removeAllDNSEntriesSync } from "./dns/dnsConfig";
import type http from "http";

const LOCAL_PORT: number = 443;
const IS_WIN: boolean = process.platform === "win32";
const ENABLE_FILE_LOG: boolean = IS_DEV;

// Clear stale dump files on every MITM start (prevents unbounded disk usage)
clearDumpDir();
const INTERNAL_REQUEST_HEADER: { name: string; value: string } = { name: "x-request-source", value: "local" };

// Host rewrite for upstream forward
const HOST_REWRITE: Record<string, string> = {
  "cloudcode-pa.googleapis.com": "daily-cloudcode-pa.googleapis.com",
};

import antigravityHandler from "./handlers/antigravity";
import copilotHandler from "./handlers/copilot";
import kiroHandler from "./handlers/kiro";
import cursorHandler from "./handlers/cursor";

interface Handler {
  intercept: (req: http.IncomingMessage, res: http.ServerResponse, bodyBuffer: Buffer, mappedModel: string | null, passthroughFn: typeof passthrough) => Promise<void>;
}

const handlers: Record<string, Handler> = {
  antigravity: antigravityHandler as unknown as Handler,
  copilot: copilotHandler as unknown as Handler,
  kiro: kiroHandler as unknown as Handler,
  cursor: cursorHandler as unknown as Handler,
};

// ── SSL / SNI ─────────────────────────────────────────────────

const certCache: Map<string, tls.SecureContext> = new Map();
let rootCAPem: string;

function sniCallback(servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void): void {
  try {
    if (certCache.has(servername)) return cb(null, certCache.get(servername));
    const certData = getCertForDomain(servername);
    if (!certData) return cb(new Error(`Failed to generate cert for ${servername}`));
    const ctx: tls.SecureContext = tls.createSecureContext({
      key: certData.key,
      cert: `${certData.cert}\n${rootCAPem}`
    });
    certCache.set(servername, ctx);
    cb(null, ctx);
  } catch (e: any) {
    err(`SNI error for ${servername}: ${e.message}`);
    cb(e);
  }
}

let sslOptions: https.ServerOptions;
try {
  if (!fs.existsSync(path.join(MITM_DIR, "rootCA.key")) || !fs.existsSync(path.join(MITM_DIR, "rootCA.crt"))) {
    log("Root CA missing, generating...");
    generateCert();
  }

  const rootKey: Buffer = fs.readFileSync(path.join(MITM_DIR, "rootCA.key"));
  const rootCert: Buffer = fs.readFileSync(path.join(MITM_DIR, "rootCA.crt"));
  rootCAPem = rootCert.toString("utf8");
  sslOptions = { key: rootKey, cert: rootCert, SNICallback: sniCallback };
} catch (e: any) {
  err(`Root CA not found: ${e.message}`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────

interface CachedIP { ip: string; ts: number; }
const cachedTargetIPs: Record<string, CachedIP> = {};
const CACHE_TTL_MS: number = 5 * 60 * 1000;

async function resolveTargetIP(hostname: string): Promise<string> {
  const cached: CachedIP | undefined = cachedTargetIPs[hostname];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ip;
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8"]);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  const addresses: string[] = await resolve4(hostname);
  cachedTargetIPs[hostname] = { ip: addresses[0], ts: Date.now() };
  return cachedTargetIPs[hostname].ip;
}

function collectBodyRaw(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getMappedModel(tool: string, model: string | null): string | null {
  if (!model) return null;
  try {
    const aliases: Record<string, string> | null = getMitmAlias(tool);
    if (!aliases) return null;
    const normalizedModel: string = String(model).replace(/^models\//, "");
    const lookup: string = MODEL_SYNONYMS?.[tool]?.[normalizedModel] || normalizedModel;
    if (aliases[lookup]) return aliases[lookup];
    const prefixKey: string | undefined = Object.keys(aliases).find((k: string) => k && aliases[k] && (lookup.startsWith(k) || k.startsWith(lookup)));
    if (prefixKey) return aliases[prefixKey];
    const patterns = MODEL_PATTERNS?.[tool] || [];
    for (const { match, alias } of patterns) {
      if (match.test(lookup) && aliases[alias]) return aliases[alias];
    }
    return null;
  } catch { return null; }
}

type ResponseDumper = ReturnType<typeof createResponseDumper>;

/**
 * Forward request to real upstream.
 */
async function passthrough(req: http.IncomingMessage, res: http.ServerResponse, bodyBuffer: Buffer, onResponse?: (buf: Buffer, headers: Record<string, string | string[] | undefined>) => void): Promise<void> {
  const originalHost: string = (req.headers.host || TARGET_HOSTS[0]).split(":")[0];
  const isChatEndpoint: boolean = (req.url || "").includes(":generateContent") || (req.url || "").includes(":streamGenerateContent");
  const targetHost: string = isChatEndpoint ? (HOST_REWRITE[originalHost] || originalHost) : originalHost;
  const dumper: ResponseDumper | null = ENABLE_FILE_LOG ? createResponseDumper(req, "passthrough") : null;

  const tool: string | null = getToolForHost(req.headers.host);
  const versionOverride = tool === "antigravity"
    ? applyAntigravityIdeVersionOverride(bodyBuffer, req.headers as Record<string, string | string[] | undefined>)
    : { bodyBuffer, headers: req.headers as Record<string, string | string[] | undefined> };
  const bodyForForwarding: Buffer = versionOverride.bodyBuffer;
  const headersForForwarding: Record<string, string | string[] | undefined> = { ...versionOverride.headers, host: targetHost };
  if (bodyForForwarding !== bodyBuffer) {
    headersForForwarding["content-length"] = String(bodyForForwarding.length);
  }

  try {
    const proto: string = await negotiateAlpn(targetHost);
    if (proto === "h2") {
      return await passthroughHttp2(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper);
    }
  } catch (e: any) {
    err(`[mitm] ALPN negotiate failed: ${e.message}, fallback to HTTP/1.1`);
  }

  return passthroughHttps(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper);
}

// ── ALPN negotiation cache ────────────────────────────────────
const alpnCache: Map<string, string> = new Map();
async function negotiateAlpn(host: string): Promise<string> {
  if (alpnCache.has(host)) return alpnCache.get(host)!;
  const ip: string = await resolveTargetIP(host);
  return new Promise<string>((resolve, reject) => {
    const socket = tls.connect({
      host: ip, port: 443, servername: host,
      ALPNProtocols: ["h2", "http/1.1"], rejectUnauthorized: false,
    }, () => {
      const proto: string = socket.alpnProtocol || "http/1.1";
      alpnCache.set(host, proto);
      log(`🔗 [mitm] ALPN ${host} → ${proto}`);
      socket.end();
      resolve(proto);
    });
    socket.once("error", reject);
    socket.setTimeout(5000, () => { socket.destroy(new Error("ALPN timeout")); });
  });
}

// HTTP/2 passthrough using node:http2 native
async function passthroughHttp2(
  req: http.IncomingMessage, res: http.ServerResponse, bodyBuffer: Buffer,
  headers: Record<string, string | string[] | undefined>, targetHost: string,
  onResponse?: (buf: Buffer, headers: Record<string, string | string[] | undefined>) => void,
  dumper?: ResponseDumper | null
): Promise<void> {
  const targetIP: string = await resolveTargetIP(targetHost);
  const h2Headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk: string = k.toLowerCase();
    if (lk === "host" || lk === "connection" || lk === "keep-alive" ||
        lk === "transfer-encoding" || lk === "upgrade" || lk === "proxy-connection") continue;
    h2Headers[lk] = v;
  }
  h2Headers[":method"] = req.method;
  h2Headers[":path"] = req.url;
  h2Headers[":scheme"] = "https";
  h2Headers[":authority"] = targetHost;

  return new Promise<void>((resolve) => {
    const client = http2.connect(`https://${targetHost}`, {
      createConnection: () => tls.connect({
        host: targetIP, port: 443, servername: targetHost,
        ALPNProtocols: ["h2"], rejectUnauthorized: false,
      }),
    });
    client.once("error", (e: Error) => {
      err(`[mitm] http2 client error: ${e.message}`);
      if (dumper) { dumper.writeChunk(`\n[ERROR h2] ${e.message}\n`); dumper.end(); }
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end("Bad Gateway");
      try { client.close(); } catch {}
      resolve();
    });

    const stream = client.request(h2Headers as http2.OutgoingHttpHeaders, { endStream: bodyBuffer.length === 0 });
    if (bodyBuffer.length > 0) stream.end(bodyBuffer);

    stream.once("response", (responseHeaders: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader) => {
      const status: number = responseHeaders[":status"]!;
      const outHeaders: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(responseHeaders)) {
        if (k.startsWith(":")) continue;
        if (k === "connection" || k === "keep-alive" || k === "transfer-encoding") continue;
        outHeaders[k] = v as string | string[] | undefined;
      }
      res.writeHead(status, outHeaders);
      if (dumper) dumper.writeHeader(status, outHeaders);

      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => {
        if (dumper) dumper.writeChunk(chunk);
        if (onResponse) chunks.push(chunk);
        res.write(chunk);
      });
      stream.on("end", () => {
        if (dumper) dumper.end();
        if (!res.writableEnded) res.end();
        if (onResponse) try { onResponse(Buffer.concat(chunks), outHeaders); } catch {}
        try { client.close(); } catch {}
        resolve();
      });
    });
    stream.once("error", (e: Error) => {
      err(`[mitm] http2 stream error: ${e.message}`);
      if (dumper) { dumper.writeChunk(`\n[ERROR h2-stream] ${e.message}\n`); dumper.end(); }
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end();
      try { client.close(); } catch {}
      resolve();
    });
  });
}

// Fallback: raw https.request HTTP/1.1 with custom DNS
async function passthroughHttps(
  req: http.IncomingMessage, res: http.ServerResponse, bodyBuffer: Buffer,
  headers: Record<string, string | string[] | undefined>, targetHost: string,
  onResponse?: (buf: Buffer, headers: Record<string, string | string[] | undefined>) => void,
  dumper?: ResponseDumper | null
): Promise<void> {
  const targetIP: string = await resolveTargetIP(targetHost);
  const forwardReq = https.request({
    hostname: targetIP,
    port: 443,
    path: req.url,
    method: req.method,
    headers,
    servername: targetHost,
    rejectUnauthorized: false
  }, (forwardRes: http.IncomingMessage) => {
    res.writeHead(forwardRes.statusCode!, forwardRes.headers as Record<string, string>);
    if (dumper) dumper.writeHeader(forwardRes.statusCode!, forwardRes.headers as Record<string, string | string[] | undefined>);

    if (!onResponse && !dumper) {
      forwardRes.pipe(res);
      return;
    }

    const chunks: Buffer[] = [];
    forwardRes.on("data", (chunk: Buffer) => {
      if (dumper) dumper.writeChunk(chunk);
      if (onResponse) chunks.push(chunk);
      res.write(chunk);
    });
    forwardRes.on("end", () => {
      if (dumper) dumper.end();
      res.end();
      if (onResponse) try { onResponse(Buffer.concat(chunks), forwardRes.headers as Record<string, string | string[] | undefined>); } catch { /* ignore */ }
    });
  });

  forwardReq.on("error", (e: Error) => {
    err(`Passthrough error: ${e.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${e.message}\n`); dumper.end(); }
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });

  if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
  forwardReq.end();
}

// ── Request handler ───────────────────────────────────────────

const server = https.createServer(sslOptions, async (req: http.IncomingMessage, res: http.ServerResponse) => {
  try {
    if (req.url === "/_mitm_health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }

    const bodyBuffer: Buffer = await collectBodyRaw(req);
    if (ENABLE_FILE_LOG) dumpRequest(req, bodyBuffer, "raw");

    // Anti-loop: skip requests from 9Router
    if (req.headers[INTERNAL_REQUEST_HEADER.name] === INTERNAL_REQUEST_HEADER.value) {
      return passthrough(req, res, bodyBuffer);
    }

    const tool: string | null = getToolForHost(req.headers.host);
    if (!tool) return passthrough(req, res, bodyBuffer);

    if (!isChatRequest(tool, req)) return passthrough(req, res, bodyBuffer);

    if (tool === "cursor") {
      return handlers[tool].intercept(req, res, bodyBuffer, null, passthrough);
    }

    const model: string | null = extractModel(req.url || "", bodyBuffer);

    if (model && (MODEL_NO_MAP[tool] || []).some((re: RegExp) => re.test(model))) {
      return passthrough(req, res, bodyBuffer);
    }

    const mappedModel: string | null = getMappedModel(tool, model);
    if (!mappedModel) {
      return passthrough(req, res, bodyBuffer);
    }

    return handlers[tool].intercept(req, res, bodyBuffer, mappedModel, passthrough);
  } catch (e: any) {
    err(`Unhandled error: ${e.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message, type: "mitm_error" } }));
  }
});

// Kill only processes LISTENING on LOCAL_PORT (not outbound connections)
function killPort(port: number): void {
  try {
    let pidList: string[] = [];
    if (IS_WIN) {
      const psCmd: string = `powershell -NonInteractive -WindowStyle Hidden -Command ` +
        `"Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`;
      const out: string = execSync(psCmd, { encoding: "utf-8", windowsHide: true }).trim();
      if (!out) return;
      pidList = out.split(/\r?\n/).map((s: string) => s.trim()).filter((p: string) => p && Number(p) !== process.pid && Number(p) > 4);
    } else {
      const out: string = execSync(`${LSOF_BIN} -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf-8", windowsHide: true }).trim();
      if (!out) return;
      pidList = out.split("\n").filter((p: string) => p && Number(p) !== process.pid);
    }
    if (pidList.length === 0) return;
    pidList.forEach((pid: string) => {
      try {
        if (IS_WIN) execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
        else process.kill(Number(pid), "SIGKILL");
      } catch (e: any) {
        err(`Failed to kill PID ${pid}: ${e.message}`);
      }
    });
    log(`Killed ${pidList.length} process(es) on port ${port}`);
  } catch (e: any) {
    if (e.status !== 1) throw e;
  }
}

try {
  killPort(LOCAL_PORT);
} catch (e: any) {
  err(`Cannot kill process on port ${LOCAL_PORT}: ${e.message}`);
  process.exit(1);
}

server.listen(LOCAL_PORT, () => log(`🚀 Server ready on :${LOCAL_PORT}`));

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") err(`Port ${LOCAL_PORT} already in use`);
  else if (e.code === "EACCES") err(`Permission denied for port ${LOCAL_PORT}`);
  else err(e.message);
  process.exit(1);
});

let isShuttingDown: boolean = false;
const shutdown = (): void => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  removeAllDNSEntriesSync();
  const forceExit = setTimeout(() => process.exit(0), 1500);
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (process.platform === "win32") process.on("SIGBREAK", shutdown);
