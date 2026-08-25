import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const origCreate = http.createServer.bind(http);

// Per-process secret proving x-9r-real-ip was stamped below rather than sent by the client.
const PEER_TOKEN: string = crypto.randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;

let backgroundRefreshStarted = false;

function startBackgroundTokenRefreshFromCustomServer(): void {
  if (backgroundRefreshStarted) return;
  backgroundRefreshStarted = true;
  const modPath = path.join(__dirname, "src", "sse", "services", "backgroundTokenRefresh");
  import(pathToFileURL(modPath + ".js").href)
    .then((m) => {
      try {
        m.startBackgroundTokenRefresh();
      } catch (e: unknown) {
        console.error("[BackgroundTokenRefresh] start failed:", e instanceof Error ? e.message : e);
      }
      const stop = () => {
        try {
          m.stopBackgroundTokenRefresh();
        } catch { /* ignore */ }
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((e: unknown) => {
      if (process.env.DEBUG_BACKGROUND_TOKEN_REFRESH) {
        console.error("[BackgroundTokenRefresh] import failed:", e instanceof Error ? e.message : e);
      }
    });
}

type HttpHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

(http.createServer as unknown as (...args: unknown[]) => http.Server) = (...args: unknown[]) => {
  const handler = args.find((a): a is HttpHandler => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...(args as Parameters<typeof origCreate>));

  const wrapped: HttpHandler = (req, res) => {
    const socketIp: string = req.socket?.remoteAddress ?? "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };

  const server = origCreate(...(rest as Parameters<typeof origCreate>), wrapped);
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
  });

  const origEmit = server.emit.bind(server);
  server.emit = function (event: string, ...eventArgs: unknown[]) {
    const [req, socket, head] = eventArgs as [http.IncomingMessage, import("node:net").Socket, Buffer];
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit(event, ...eventArgs);
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      socket.destroy();
      return true;
    }
    const chunks: Buffer[] = [head];
    let received = head.length;
    const serve = () => {
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (received) replay.push(Buffer.concat(chunks, received).subarray(0, contentLength));
      replay.push(null);
      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve().then(() => wrapped(replay, res)).catch((error: unknown) => {
        console.error("Failed to downgrade h2c request", error);
        socket.destroy();
      });
    };
    if (received >= contentLength) serve();
    else {
      socket.on("data", function readBody(chunk: Buffer) {
        chunks.push(chunk);
        received += chunk.length;
        if (received < contentLength) return;
        socket.off("data", readBody);
        serve();
      });
      socket.resume();
    }
    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    return true;
  } as typeof server.emit;

  return server;
};

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  const standalone = path.join(__dirname, "server.js");
  if (fs.existsSync(standalone)) {
    await import(pathToFileURL(standalone).href);
  } else {
    const nextBin = import.meta.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin ?? "", "start", ...process.argv.slice(2)];
    await import(nextBin!);
  }
}
