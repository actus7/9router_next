import { spawn } from "node:child_process";
import type { Logger } from "../services/types";

const MCP_TOOL_PREFIX = "mcp_";

function fromMcpToolName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}

function rpc(method: string, params: unknown, id?: number): string {
  const message: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (id !== undefined) message.id = id;
  return JSON.stringify(message) + "\n";
}

function extractResultText(result: Record<string, unknown>): string {
  if (typeof result.content === "string") return result.content;
  if (typeof result.text === "string") return result.text;
  const message = result.message as Record<string, unknown> | undefined;
  if (message && typeof message.content === "string") return message.content;
  if (!Array.isArray(result.messages)) return "";
  return (result.messages as Record<string, unknown>[])
    .filter((entry) => entry.role === "assistant")
    .map((entry) => String(entry.content || ""))
    .join("\n");
}

interface AcpStreamCtx {
  emit: (data: string) => void;
  responseId: string;
  created: number;
  model: string;
  promptText: string;
  workspaceCwd: string;
  roleEmitted: boolean;
  totalText: string;
  finished: boolean;
  toolUseEmitted: boolean;
  pendingClientTools: Map<string, string>;
  hasClientTools: boolean;
  stdinClosed: boolean;
  idCounter: number;
  sessionId: string | null;
  initDone: boolean;
  sessionCreated: boolean;
  promptSent: boolean;
  child: ReturnType<typeof spawn>;
  cleanupMcp: () => void;
  log: Logger | undefined;
}

function ctxSendRpc(ctx: AcpStreamCtx, method: string, params: unknown): number | undefined {
  if (ctx.stdinClosed || ctx.child.stdin!.destroyed) return;
  const id = ctx.idCounter++;
  try { ctx.child.stdin!.write(rpc(method, params, id)); } catch { /* ignore */ }
  return id;
}

function ctxEmitDelta(ctx: AcpStreamCtx, delta: string) {
  if (!ctx.roleEmitted) {
    ctx.emit(`data: ${JSON.stringify({
      id: ctx.responseId, object: "chat.completion.chunk", created: ctx.created, model: ctx.model,
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    })}\n\n`);
    ctx.roleEmitted = true;
  }
  ctx.totalText += delta;
  ctx.emit(`data: ${JSON.stringify({
    id: ctx.responseId, object: "chat.completion.chunk", created: ctx.created, model: ctx.model,
    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
  })}\n\n`);
}

function ctxEmitToolUse(ctx: AcpStreamCtx, toolName: string, args: unknown, toolCallId: string) {
  const argsStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
  if (!ctx.roleEmitted) {
    ctx.emit(`data: ${JSON.stringify({
      id: ctx.responseId, object: "chat.completion.chunk", created: ctx.created, model: ctx.model,
      choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }],
    })}\n\n`);
    ctx.roleEmitted = true;
  }
  ctx.emit(`data: ${JSON.stringify({
    id: ctx.responseId, object: "chat.completion.chunk", created: ctx.created, model: ctx.model,
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: toolCallId, type: "function", function: { name: toolName, arguments: argsStr } }] }, finish_reason: null }],
  })}\n\n`);
}

function ctxFinish(ctx: AcpStreamCtx, error?: string | null, finishReason = "stop") {
  if (ctx.finished) return;
  ctx.finished = true;

  if (error) {
    ctx.emit(`data: ${JSON.stringify({ error: { message: error, type: "devin_cli_error" } })}\n\n`);
  } else {
    ctx.emit(`data: ${JSON.stringify({
      id: ctx.responseId, object: "chat.completion.chunk", created: ctx.created, model: ctx.model,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      usage: {
        prompt_tokens: Math.ceil(ctx.promptText.length / 4),
        completion_tokens: Math.ceil(ctx.totalText.length / 4),
        total_tokens: Math.ceil((ctx.promptText.length + ctx.totalText.length) / 4),
        estimated: true,
      },
    })}\n\n`);
  }
  ctx.emit("data: [DONE]\n\n");

  try {
    if (!ctx.stdinClosed) {
      ctx.stdinClosed = true;
      ctx.child.stdin!.end();
    }
  } catch { /* ignore */ }

  const killTimer = setTimeout(() => {
    if (!ctx.child.killed) ctx.child.kill("SIGKILL");
  }, 2000);
  killTimer.unref?.();

  ctx.cleanupMcp();
}

// ─── ACP line handler ───────────────────────────────────────────────────────

/** Handle session/update streaming notification */
function handleSessionUpdate(msg: Record<string, unknown>, ctx: AcpStreamCtx) {
  const params = msg.params as Record<string, unknown> | undefined;
  if (!params) return;

  const update = (params.update as Record<string, unknown>) || {};
  const type = (update.sessionUpdate as string) || (params.type as string);
  const contentField = update.content !== undefined ? update.content : params.content;
  const deltaText: string =
    typeof contentField === "string" ? contentField
      : String((contentField as Record<string, unknown>)?.text ?? params.delta ?? params.text ?? "");

  // Client-tool bridge: devin calling a tool from our exposed MCP
  if (ctx.hasClientTools && !ctx.toolUseEmitted && (type === "tool_call" || type === "tool_call_update")) {
    const tcId = update.toolCallId as string;
    if (typeof update.title === "string" && update.title.startsWith("Calling mcp_") && /from clientTools\b/.test(update.title)) {
      const nameMatch = update.title.match(/^Calling (mcp_\S+)\b/);
      const mcpName = nameMatch ? nameMatch[1] : "";
      const origName = fromMcpToolName(mcpName);
      if (tcId && origName) ctx.pendingClientTools.set(tcId, origName);
    }
    const origName = tcId ? ctx.pendingClientTools.get(tcId) : null;
    if (origName && update.rawInput) {
      ctx.toolUseEmitted = true;
      ctx.pendingClientTools.delete(tcId);
      ctxEmitToolUse(ctx, origName, update.rawInput, tcId || `call_${Date.now()}`);
      ctxFinish(ctx, null, "tool_calls");
    }
    return;
  }

  if (type === "agent_message_chunk" || type === "message_delta" || type === "text_delta" || type === "content_delta") {
    if (deltaText) ctxEmitDelta(ctx, deltaText);
  } else if (type === "agent_thought_chunk") {
    // Internal reasoning — not surfaced to the client.
  } else if (type === "message_stop" || type === "stop" || type === "done") {
    ctxFinish(ctx);
  } else if (type === "error") {
    ctxFinish(ctx, String(params.message || params.error || "Devin ACP error"));
  }
}

function handleDevinInit(msg: Record<string, unknown>, ctx: AcpStreamCtx): boolean {
  if (!ctx.initDone && msg.result !== undefined && !msg.method) {
    ctx.initDone = true;
    ctxSendRpc(ctx, "session/new", {
      cwd: ctx.workspaceCwd,
      mcpServers: [],
      model: ctx.model || undefined,
    });
    return true;
  }
  return false;
}

function handleDevinSessionNew(msg: Record<string, unknown>, ctx: AcpStreamCtx): boolean {
  if (ctx.initDone && !ctx.sessionCreated && msg.result !== undefined && !msg.method) {
    const res = (msg.result as Record<string, unknown>) || {};
    ctx.sessionId = (res.sessionId as string) || null;
    if (!ctx.sessionId) {
      ctxFinish(ctx, "Devin ACP: session/new returned no sessionId");
      return true;
    }
    ctx.sessionCreated = true;
    ctx.promptSent = true;
    ctxSendRpc(ctx, "session/prompt", {
      sessionId: ctx.sessionId,
      prompt: [{ type: "text", text: ctx.promptText }],
    });
    return true;
  }
  return false;
}

function handleDevinPromptResult(msg: Record<string, unknown>, ctx: AcpStreamCtx): boolean {
  if (ctx.sessionCreated && ctx.promptSent && msg.result !== undefined && !msg.method) {
    if (!ctx.roleEmitted) {
      const res = (msg.result as Record<string, unknown>) || undefined;
      const content = extractResultText(res!);
      if (content) {
        ctx.totalText = content;
        ctxEmitDelta(ctx, content);
      }
      const stopReason = (res && res.stopReason as string) || "";
      if (stopReason && stopReason !== "cancelled") ctxFinish(ctx);
    }
    return true;
  }
  return false;
}

function handleDevinPermission(msg: Record<string, unknown>, ctx: AcpStreamCtx): boolean {
  if (msg.method === "session/request_permission" && msg.id !== undefined) {
    const options = ((msg.params as Record<string, unknown>)?.options as Record<string, unknown>[]) || [];
    const allow = options.find((o: Record<string, unknown>) => /allow/i.test(String(o.kind || ""))) || options[0];
    if (allow) {
      ctx.child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0", id: msg.id,
          result: { outcome: { outcome: "selected", optionId: (allow as Record<string, unknown>).optionId } },
        }) + "\n"
      );
    }
    return true;
  }
  return false;
}

function handleDevinAgentStopped(msg: Record<string, unknown>, ctx: AcpStreamCtx): boolean {
  if (msg.method === "_cognition.ai/agent_stopped" || msg.method === "$/agent_stopped") {
    const params = msg.params as Record<string, unknown>;
    if (params?.cause === "error") {
      ctxFinish(ctx, String(params?.errorMessage || params?.message || params?.error || "Devin agent error"));
    } else {
      ctxFinish(ctx);
    }
    return true;
  }
  return false;
}

/** Process a single NDJSON line from devin stdout */
function handleAcpLine(msg: Record<string, unknown>, ctx: AcpStreamCtx) {
  if (handleDevinInit(msg, ctx)) return;
  if (handleDevinSessionNew(msg, ctx)) return;
  if (handleDevinPromptResult(msg, ctx)) return;
  if (handleDevinPermission(msg, ctx)) return;
  if (handleDevinAgentStopped(msg, ctx)) return;

  // Streaming notifications
  if (msg.method === "session/update" || msg.method === "$/update") {
    handleSessionUpdate(msg, ctx);
    return;
  }

  // Error responses
  if (msg.error) {
    const err = msg.error as Record<string, unknown>;
    ctxFinish(ctx, `Devin ACP error ${err.code}: ${err.message}`);
  }
}

// ─── Stream creation ────────────────────────────────────────────────────────

/** Set up NDJSON line reader on child stdout */
function setupNdjsonReader(child: ReturnType<typeof spawn>, ctx: AcpStreamCtx) {
  let buffer = "";
  child.stdout!.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line); } catch { continue; }
      handleAcpLine(msg, ctx);
    }
  });
}

/** Set up stderr, close, and initialize handlers */
function setupProcessHandlers(
  child: ReturnType<typeof spawn>,
  ctx: AcpStreamCtx,
  spawnError: Error | null,
  cleanupMcp: () => void,
  log: Logger | undefined,
) {
  child.stderr!.on("data", (chunk) => {
    log?.debug?.("DEVIN", `stderr: ${chunk.toString("utf8").slice(0, 200)}`);
  });

  child.on("close", (code) => {
    if (!ctx.finished) {
      if (code !== 0 && !spawnError) {
        ctxFinish(ctx, ctx.roleEmitted ? undefined : `Devin CLI exited with code ${code}`);
      } else {
        ctxFinish(ctx);
      }
    } else {
      cleanupMcp();
    }
  });
}

export function createDevinAcpStream(
  model: string,
  promptText: string,
  workspaceCwd: string,
  devinBin: string,
  mcpConfigDir: string | null,
  hasClientTools: boolean,
  signal: AbortSignal | undefined,
  log: Logger | undefined,
  cleanupMcp: () => void,
): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const emit = (data: string) => controller.enqueue(enc.encode(data));

      const env = { ...process.env };
      env.DEVIN_PERMISSION_MODE = process.env.DEVIN_PERMISSION_MODE || "bypass";
      if (mcpConfigDir) env.XDG_CONFIG_HOME = mcpConfigDir;

      const agentType = process.env.CLI_DEVIN_AGENT_TYPE?.trim();
      const acpArgs = ["acp"];
      if (agentType) acpArgs.push("--agent-type", agentType);

      const child = spawn(/*turbopackIgnore: true*/ devinBin, acpArgs, {
        env,
        cwd: workspaceCwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      let spawnError: Error | null = null;

      child.on("error", (err) => {
        spawnError = err;
        const msg = err.message.includes("ENOENT") || err.message.includes("not found")
          ? `Devin CLI not found: ${devinBin}. Install via https://cli.devin.ai or set CLI_DEVIN_BIN env var.`
          : `Devin CLI spawn error: ${err.message}`;
        emit(`data: ${JSON.stringify({ error: { message: msg, type: "devin_cli_error", code: "spawn_failed" } })}\n\n`);
        emit("data: [DONE]\n\n");
        controller.close();
      });

      if (signal) {
        signal.addEventListener("abort", () => {
          if (!child.killed) child.kill("SIGTERM");
        });
      }

      const ctx: AcpStreamCtx = {
        emit, responseId: `chatcmpl-devin-${Date.now()}`, created: Math.floor(Date.now() / 1000),
        model, promptText, workspaceCwd,
        roleEmitted: false, totalText: "", finished: false, toolUseEmitted: false,
        pendingClientTools: new Map(), hasClientTools, stdinClosed: false,
        idCounter: 1, sessionId: null, initDone: false, sessionCreated: false, promptSent: false,
        child, cleanupMcp, log,
      };

      setupNdjsonReader(child, ctx);
      setupProcessHandlers(child, ctx, spawnError, cleanupMcp, log);

      // Send initialize
      ctxSendRpc(ctx, "initialize", {
        protocolVersion: "0.3",
        clientInfo: { name: "modelhub", version: "1.0" },
        capabilities: {},
      });
    },
  });
}

