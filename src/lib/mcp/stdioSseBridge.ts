// Inline stdio<->SSE bridge for MCP. Spawns one child per plugin on demand,
// broadcasts JSON-RPC frames over SSE, accepts client messages via HTTP POST.

import { spawn, ChildProcess } from "child_process";
import crypto from "crypto";
import { LOCAL_STDIO_PLUGINS } from "@/shared/constants/coworkPlugins";

const G_KEY: string = "__9routerMcpBridges";
const MAX_TEXT_CHARS: number = 50000;
const COLLAPSE_THRESHOLD: number = 30;
const COLLAPSE_KEEP_HEAD: number = 10;
const COLLAPSE_KEEP_TAIL: number = 5;

interface Plugin {
  name: string;
  command: string;
  args: string[];
}

interface BridgeEntry {
  proc: ChildProcess;
  sessions: Map<string, (data: string) => void>;
  buffer: string;
}

// Drop noise nodes, collapse repeated siblings, hard-truncate. Preserve [ref=eXX].
function smartFilterText(text: string): string {
  if (typeof text !== "string" || text.length < 2000) return text;
  let out: string = text;
  out = out.replace(/^\s*-\s*generic:?\s*$/gm, "");
  out = out.replace(/^\s*-\s*text:\s*""\s*$/gm, "");
  out = collapseRepeated(out);
  if (out.length > MAX_TEXT_CHARS) {
    const head: string = out.slice(0, MAX_TEXT_CHARS - 300);
    out = `${head}\n\n... [truncated ${text.length - head.length} chars by 9router bridge. Page is large; ask user to scroll/navigate to a specific section, or click an element with the refs shown above]`;
  }
  return out;
}

// Group consecutive lines sharing the same leading indent + role prefix; collapse if >= COLLAPSE_THRESHOLD.
function collapseRepeated(text: string): string {
  const lines: string[] = text.split("\n");
  const out: string[] = [];
  let i: number = 0;
  while (i < lines.length) {
    const line: string = lines[i];
    const m: RegExpMatchArray | null = line.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (!m) { out.push(line); i++; continue; }
    const indent: string = m[1];
    const role: string = m[2];
    let j: number = i;
    while (j < lines.length) {
      const ln: string = lines[j];
      const mm: RegExpMatchArray | null = ln.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
      if (mm && mm[1] === indent && mm[2] === role) { j++; continue; }
      if (ln.startsWith(`${indent} `) || ln.startsWith(`${indent}\t`)) { j++; continue; }
      break;
    }
    const groupLen: number = j - i;
    if (groupLen >= COLLAPSE_THRESHOLD) {
      const headEnd: number = findNthSiblingEnd(lines, i, indent, role, COLLAPSE_KEEP_HEAD);
      const tailStart: number = findLastNSiblingStart(lines, j, indent, role, COLLAPSE_KEEP_TAIL);
      for (let k = i; k < headEnd; k++) out.push(lines[k]);
      out.push(`${indent}... [${groupLen - COLLAPSE_KEEP_HEAD - COLLAPSE_KEEP_TAIL} similar "${role}" items omitted by 9router bridge]`);
      for (let k = tailStart; k < j; k++) out.push(lines[k]);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return out.join("\n");
}

function findNthSiblingEnd(lines: string[], start: number, indent: string, role: string, n: number): number {
  let count: number = 0;
  for (let k = start; k < lines.length; k++) {
    const mm: RegExpMatchArray | null = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) {
      count++;
      if (count > n) return k;
    }
  }
  return lines.length;
}

function findLastNSiblingStart(lines: string[], end: number, indent: string, role: string, n: number): number {
  const positions: number[] = [];
  for (let k = 0; k < end; k++) {
    const mm: RegExpMatchArray | null = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) positions.push(k);
  }
  return positions.length > n ? positions[positions.length - n] : end;
}

// Apply filter to JSON-RPC tool/result content text blocks only.
function filterFrame(line: string): string {
  try {
    const msg: Record<string, unknown> = JSON.parse(line);
    const content: Array<Record<string, unknown>> | undefined = (msg?.result as Record<string, unknown>)?.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return line;
    let mutated: boolean = false;
    for (const item of content) {
      if (item?.type === "text" && typeof item.text === "string") {
        const filtered: string = smartFilterText(item.text);
        if (filtered !== item.text) { item.text = filtered; mutated = true; }
      }
    }
    return mutated ? JSON.stringify(msg) : line;
  } catch { return line; }
}

const getStore = (): Map<string, BridgeEntry> => {
  if (!(globalThis as Record<string, unknown>)[G_KEY]) (globalThis as Record<string, unknown>)[G_KEY] = new Map();
  return (globalThis as Record<string, unknown>)[G_KEY] as Map<string, BridgeEntry>;
};

// Only preset stdio plugins may spawn. No user-defined commands (RCE prevention).
function findPlugin(name: string): Plugin | null {
  return (LOCAL_STDIO_PLUGINS as Plugin[]).find((p: Plugin) => p.name === name) || null;
}

function getOrSpawn(name: string): BridgeEntry {
  const store: Map<string, BridgeEntry> = getStore();
  let entry: BridgeEntry | undefined = store.get(name);
  if (entry?.proc && !entry.proc.killed && entry.proc.exitCode === null) return entry;

  const plugin: Plugin | null = findPlugin(name);
  if (!plugin) throw new Error(`Unknown local plugin: ${name}`);

  const proc: ChildProcess = spawn(plugin.command, plugin.args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  entry = { proc, sessions: new Map(), buffer: "" };
  store.set(name, entry);

  // Parse newline-delimited JSON-RPC from child stdout, broadcast to all sessions.
  proc.stdout!.on("data", (chunk: Buffer) => {
    entry!.buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = entry!.buffer.indexOf("\n")) >= 0) {
      const raw: string = entry!.buffer.slice(0, idx).trim();
      entry!.buffer = entry!.buffer.slice(idx + 1);
      if (!raw) continue;
      const line: string = filterFrame(raw);
      for (const send of entry!.sessions.values()) {
        try { send(`event: message\ndata: ${line}\n\n`); } catch { /* ignore broken pipe */ }
      }
    }
  });

  proc.stderr!.on("data", (d: Buffer) => console.log(`[mcp:${name}]`, d.toString().trim()));
  proc.on("exit", (code: number | null) => {
    console.log(`[mcp:${name}] exited`, code);
    store.delete(name);
  });

  return entry;
}

function registerSession(name: string, sendFn: (data: string) => void): string {
  const entry: BridgeEntry = getOrSpawn(name);
  const sid: string = crypto.randomUUID();
  entry.sessions.set(sid, sendFn);
  return sid;
}

function unregisterSession(name: string, sid: string): void {
  const entry: BridgeEntry | undefined = getStore().get(name);
  if (!entry) return;
  entry.sessions.delete(sid);
  // No sessions left → kill child to avoid idle orphan process leak.
  if (entry.sessions.size === 0) {
    try { entry.proc.kill(); } catch { /* ignore */ }
    getStore().delete(name);
  }
}

// Kill all spawned MCP children — called on app shutdown to prevent orphans.
function killAllBridges(): void {
  const store: Map<string, BridgeEntry> = getStore();
  for (const [name, entry] of store) {
    try { entry.proc.kill(); } catch { /* ignore */ }
    store.delete(name);
  }
}

function sendToChild(name: string, jsonRpc: Record<string, unknown>): void {
  const entry: BridgeEntry | undefined = getStore().get(name);
  if (!entry?.proc?.stdin?.writable) throw new Error(`Bridge not running: ${name}`);
  entry.proc.stdin.write(`${JSON.stringify(jsonRpc)}\n`);
}

function isRunning(name: string): boolean {
  const entry: BridgeEntry | undefined = getStore().get(name);
  return !!(entry?.proc && !entry.proc.killed && entry.proc.exitCode === null);
}

export { getOrSpawn, registerSession, unregisterSession, sendToChild, isRunning, findPlugin, killAllBridges };
