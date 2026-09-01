/**
 * DevinCliExecutor — routes completions through the official Devin CLI binary
 * via the Agent Client Protocol (ACP) JSON-RPC 2.0 over stdio.
 *
 * Protocol flow:
 *   1. Spawn `devin acp` (default agent = full built-in tools: fs/shell/search).
 *      Set CLI_DEVIN_AGENT_TYPE=summarizer for a tool-less, text-only mode.
 *   2. Send: initialize → session/new (with model + cwd + mcpServers) → session/prompt.
 *   3. Receive: session/update notifications (agent_message_chunk = reply text,
 *      tool_call/tool_call_update = built-in tool invocations, surfaced as text).
 *      When devin calls a client-tool from the exposed MCP ("Calling mcp_X from
 *      clientTools"), it is bridged to an OpenAI tool_use and the turn ends.
 *   4. Emit deltas as OpenAI-compatible SSE chunks.
 *   5. Kill subprocess on _cognition.ai/agent_stopped or error.
 *
 * Auth: noAuth — the subprocess inherits the parent env and uses credentials
 * stored by `devin auth login` (~/.local/share/devin/credentials.toml).
 *
 * Binary discovery: CLI_DEVIN_BIN env → PATH lookup → platform installer paths.
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { BaseExecutor } from "./base";
import type { ExecuteArgs } from "./base";
import type { Logger } from "../services/types";
import { createDevinAcpStream } from "./devinAcpStream";

// ─── Binary discovery ────────────────────────────────────────────────────────

function resolveDevinBin() {
  const envBin = process.env.CLI_DEVIN_BIN?.trim();
  if (envBin) return envBin;

  const isWin = process.platform === "win32";
  const home = os.homedir();

  const candidates = isWin
    ? [
      path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "devin", "cli", "bin", "devin.exe"),
      path.join(home, ".local", "bin", "devin.exe"),
      path.join(home, "scoop", "shims", "devin.exe"),
      path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs", "devin", "devin.exe"),
    ]
    : [
      path.join(home, ".local", "share", "devin", "bin", "devin"),
      path.join(home, ".devin", "bin", "devin"),
      path.join(home, ".local", "bin", "devin"),
      "/opt/homebrew/bin/devin",
      "/usr/local/bin/devin",
      "/usr/bin/devin",
    ];
  for (const candidate of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
  }

  return isWin ? "devin.exe" : "devin";
}

// ─── Client-tools → MCP bridge ───────────────────────────────────────────────

const CLIENT_TOOLS_MCP_SCRIPT = `
import readline from "node:readline";
const TOOLS = JSON.parse(process.env.DEVIN_MCP_TOOLS || "[]");
const RESULTS = JSON.parse(process.env.DEVIN_MCP_RESULTS || "{}");
const rl = readline.createInterface({ input: process.stdin });
function send(o){ process.stdout.write(JSON.stringify(o) + "\\n"); }
rl.on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") {
    send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "clientTools", version: "1.0" } } });
  } else if (m.method === "tools/list") {
    send({ jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
  } else if (m.method === "tools/call") {
    const name = m.params?.name || "";
    const seeded = RESULTS[name];
    const text = seeded !== undefined
      ? String(seeded)
      : "(awaiting client tool_result)";
    process.stderr.write("[client-tools] tool_call name=" + name + " seeded=" + (seeded !== undefined) + "\\n");
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text }] } });
  }
});
`.trimStart();

function ensureClientToolsScript() {
  const scriptPath = path.join(os.tmpdir(), "modelhub-devin-client-tools.mjs");
  fs.writeFileSync(scriptPath, CLIENT_TOOLS_MCP_SCRIPT);
  return scriptPath;
}

const MCP_TOOL_PREFIX = "mcp_";
function toMcpToolName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name : MCP_TOOL_PREFIX + name;
}

function buildClientToolsMcp(tools: Record<string, unknown>[], resultMap: Record<string, string>): Record<string, unknown> | null {
  const mcpTools: Record<string, unknown>[] = [];
  for (const t of tools) {
    if (!t) continue;
    const f = (t.function as Record<string, unknown>) || t;
    if (!f?.name) continue;
    mcpTools.push({
      name: toMcpToolName(f.name as string),
      description: (f.description as string) || "",
      inputSchema: f.parameters || (f as Record<string, unknown>).input_schema || { type: "object", properties: {} },
    });
  }
  if (!mcpTools.length) return null;
  const env: Record<string, string> = { DEVIN_MCP_TOOLS: JSON.stringify(mcpTools) };
  if (resultMap && Object.keys(resultMap).length) {
    env.DEVIN_MCP_RESULTS = JSON.stringify(resultMap);
  }
  return {
    command: process.execPath,
    args: [ensureClientToolsScript()],
    env,
  };
}

function extractClientToolResults(messages: Record<string, unknown>[]): Record<string, string> {
  const idToMcpName = new Map<string, string>();
  const results: Record<string, string> = {};
  for (const m of messages) {
    if (m?.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Record<string, unknown>[]) {
        const name = (tc?.function as Record<string, unknown>)?.name || tc?.name;
        if (tc?.id && name) idToMcpName.set(tc.id as string, toMcpToolName(name as string));
      }
    }
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content as Record<string, unknown>[]) {
        if (b?.type === "tool_use" && b.id && b.name) {
          idToMcpName.set(b.id as string, toMcpToolName(b.name as string));
        }
      }
    }
    if (m?.role === "tool" && m.tool_call_id) {
      const mcpName = idToMcpName.get(m.tool_call_id as string);
      if (mcpName) {
        results[mcpName] = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      }
    }
    if (m?.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content as Record<string, unknown>[]) {
        if (b?.type === "tool_result" && b.tool_use_id) {
          const mcpName = idToMcpName.get(b.tool_use_id as string);
          if (mcpName) {
            const c = b.content;
            results[mcpName] = typeof c === "string" ? c : JSON.stringify(c ?? "");
          }
        }
      }
    }
  }
  return results;
}

function resolveWorkspaceCwd(body: Record<string, unknown>): string {
  const candidates: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) candidates.push(v.trim());
  };
  push(body?.cwd);
  push(body?.working_directory);
  push(body?.workdir);
  push(body?.workspace);
  push((body?.metadata as Record<string, unknown>)?.cwd);
  push((body?.metadata as Record<string, unknown>)?.working_directory);

  const scanText = (text: unknown) => {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(/<cwd>\s*([^<]+?)\s*<\/cwd>/gi)) push(m[1]);
  };
  const scanMessages = (msgs: unknown) => {
    if (!Array.isArray(msgs)) return;
    for (const msg of msgs as Record<string, unknown>[]) {
      if (!msg) continue;
      if (typeof msg.content === "string") scanText(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const p of msg.content as Record<string, unknown>[]) {
          if (typeof p === "string") scanText(p);
          else if (p && typeof p === "object") {
            scanText(p.text);
            scanText(p.input_text);
            scanText(p.content);
          }
        }
      }
      if (typeof msg === "string") scanText(msg);
      if (msg.type === "message" && Array.isArray(msg.content)) {
        for (const p of msg.content as Record<string, unknown>[]) scanText(p?.text || p?.input_text);
      }
    }
  };
  scanMessages(body?.messages);
  scanMessages(body?.input);

  for (const c of candidates) {
    try {
      if (path.isAbsolute(c) && fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch { /* ignore */ }
  }
  return os.tmpdir();
}

// ─── Multi-turn message → single prompt builder ─────────────────────────────

function buildPromptText(messages: Record<string, unknown>[]): string {
  const lines = [];
  for (const m of messages) {
    const role = String(m.role || "user");
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "text") text += String(p.text || "");
        else if (p.type === "tool_use") {
          text += `\n[Tool call ${p.name} id=${p.id}]\n${JSON.stringify(p.input ?? {})}\n`;
        } else if (p.type === "tool_result") {
          const c = typeof p.content === "string" ? p.content : JSON.stringify(p.content ?? "");
          text += `\n[Tool result id=${p.tool_use_id}]\n${c}\n`;
        }
      }
    }
    if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const parts = m.tool_calls.map((tc: Record<string, unknown>) => {
        const name = (tc.function as Record<string, unknown>)?.name || tc.name || "tool";
        const args = (tc.function as Record<string, unknown>)?.arguments ?? tc.arguments ?? {};
        const argStr = typeof args === "string" ? args : JSON.stringify(args);
        return `[Tool call ${name} id=${tc.id}]\n${argStr}`;
      });
      text = [text, ...parts].filter(Boolean).join("\n\n");
    }
    if (role === "tool") {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      text = `[Tool result id=${m.tool_call_id || ""}]\n${c}`;
    }
    if (!text.trim()) continue;
    if (role === "system") lines.push(`[System]\n${text}`);
    else if (role === "assistant") lines.push(`[Assistant]\n${text}`);
    else if (role === "tool") lines.push(`[Tool]\n${text}`);
    else lines.push(`[User]\n${text}`);
  }
  return lines.join("\n\n") || "(empty)";
}

// ─── MCP config preparation ─────────────────────────────────────────────────

function prepareMcpConfig(
  tools: Record<string, unknown>[],
  messages: Record<string, unknown>[],
  log: Logger | undefined,
) {
  const mcpServers: Record<string, unknown> = {};
  const mcpJson = process.env.DEVIN_MCP_SERVERS?.trim();
  if (mcpJson) {
    try {
      Object.assign(mcpServers, JSON.parse(mcpJson));
    } catch (e: unknown) {
      log?.info?.("DEVIN", `DEVIN_MCP_SERVERS parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const clientToolResults = extractClientToolResults(messages);
  const clientToolsMcp = buildClientToolsMcp(tools, clientToolResults);
  const hasClientTools = !!clientToolsMcp;

  if (clientToolsMcp) {
    mcpServers["clientTools"] = clientToolsMcp;
    const seeded = Object.keys(clientToolResults).length;
    log?.info?.("DEVIN", `exposing ${tools.length} client tool(s) as MCP` + (seeded ? ` (seeded ${seeded} result(s))` : ""));
  }

  let mcpConfigDir: string | null = null;
  if (Object.keys(mcpServers).length) {
    try {
      mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
      const cfgDev = path.join(mcpConfigDir, "devin");
      fs.mkdirSync(cfgDev, { recursive: true });
      fs.writeFileSync(path.join(cfgDev, "config.json"), JSON.stringify({ mcpServers }));
      log?.info?.("DEVIN", `mcp config written → ${mcpConfigDir}`);
    } catch (e: unknown) {
      log?.info?.("DEVIN", `mcp config write failed: ${e instanceof Error ? e.message : String(e)}`);
      mcpConfigDir = null;
    }
  }

  const cleanupMcp = () => {
    if (!mcpConfigDir) return;
    try { fs.rmSync(mcpConfigDir, { recursive: true, force: true }); } catch { /* ignore */ }
    mcpConfigDir = null;
  };

  return { mcpServers, mcpConfigDir, hasClientTools, clientToolResults, tools, cleanupMcp };
}

// ─── ACP stream context ─────────────────────────────────────────────────────

// ─── DevinCliExecutor ─────────────────────────────────────────────────────────

export class DevinCliExecutor extends BaseExecutor {
  constructor() {
    super("devin-cli", { id: "devin-cli", baseUrl: "devin://acp/stdio" });
  }

  buildUrl() {
    return "devin://acp/stdio";
  }

  buildHeaders(): Record<string, string> {
    return {};
  }

  transformRequest(_model: string, body: Record<string, unknown>, _stream: boolean, _credentials: import("../services/types").Credentials): Record<string, unknown> {
    return body;
  }

  async execute({ model, body, credentials: _credentials, signal, log }: ExecuteArgs) {
    const b = body ?? {};
    const messages = Array.isArray(b.messages) ? b.messages : Array.isArray(b.input) ? b.input : [];
    const promptText = buildPromptText(messages);
    const workspaceCwd = resolveWorkspaceCwd(b);
    const devinBin = resolveDevinBin();

    log?.info?.("DEVIN", `devin acp → model=${model}, bin=${devinBin}, cwd=${workspaceCwd}`);

    const clientTools = Array.isArray(b.tools) ? (b.tools as Record<string, unknown>[]).filter(Boolean) : [];
    const mcpConfig = prepareMcpConfig(clientTools, messages as Record<string, unknown>[], log);

    const sseStream = createDevinAcpStream(
      model as string, promptText, workspaceCwd, devinBin,
      mcpConfig.mcpConfigDir, mcpConfig.hasClientTools,
      signal, log, mcpConfig.cleanupMcp,
    );

    return {
      response: new Response(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }),
      url: "devin://acp/stdio",
      headers: {} as Record<string, string>,
      transformedBody: {
        model,
        cwd: workspaceCwd,
        clientTools: clientTools.map((t: Record<string, unknown>) => ((t.function as Record<string, unknown>)?.name as string) || (t.name as string)).filter(Boolean),
        clientToolResults: Object.keys(mcpConfig.clientToolResults),
        mcpServers: Object.keys(mcpConfig.mcpServers),
        promptLength: Array.isArray(body?.messages)
          ? body.messages.length
          : Array.isArray(body?.input) ? body.input.length : 0,
      } as Record<string, unknown>,
    };
  }
}

export default DevinCliExecutor;
