/**
 * OpenCode free-tier client fingerprint (opencode.ai /inference/v1 gate).
 *
 * Two body-side gates (live probes 2026-10-26, decolua/9router v0.5.111):
 *
 * - Tools: free-tier requests must declare OpenCode's own `read` and `shell`
 *   tools with their exact descriptions and parameter schemas; stubbed
 *   descriptions, renamed schemas or tool_choice "none" answer 403
 *   FreeTierError. Caller tools travel untouched, except one already using a
 *   fingerprint name with a different definition: it goes under an alias and
 *   the response side restores the caller's name.
 * - System prompt: the CLI's `<env>` marker must be present. Missing either
 *   half (marker or tools) answers 429 FreeUsageLimitError whatever the
 *   headers say.
 *
 * Transport is the third gate and lives in services/opencodeTlsClient.ts.
 *
 * Fail-open: a surprising body is left alone rather than thrown on — a
 * fingerprint miss costs a 429 upstream, a throw here kills the request.
 */
import os from "node:os";
import path from "node:path";

/** Names required by the upstream free-tier gate. */
export const OPENCODE_FINGERPRINT_TOOLS = ["read", "shell"] as const;
type FingerprintKey = (typeof OPENCODE_FINGERPRINT_TOOLS)[number];

type ToolMap = Map<string, string>;
type AnyRecord = Record<string, unknown>;

// Verbatim from the OpenCode v2.0.26 CLI. Upstream compares description and
// parameters, so do not reword or reformat these.
const FINGERPRINT_TOOL_DEFINITIONS: Record<FingerprintKey, { description: string; parameters: AnyRecord & { properties: AnyRecord; required: string[] } }> = {
  read: {
    description: "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory to read" },
        offset: { type: "integer", minimum: 0, description: "The line or directory entry to start reading from (1-based)" },
        limit: { type: "integer", minimum: 0, description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  shell: {
    description: "Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command string to execute" },
        workdir: { type: "string", description: "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead." },
        timeout: { type: "integer", minimum: 0, description: "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default." },
        background: { type: "boolean", description: "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

const renamedToolNames = new WeakMap<object, ToolMap>();

function isObject(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The fingerprint name when `name` is exactly one; "" otherwise (case matters upstream). */
export function fingerprintToolKey(name: unknown): FingerprintKey | "" {
  const trimmed = String(name ?? "").trim();
  return (OPENCODE_FINGERPRINT_TOOLS as readonly string[]).includes(trimmed) ? trimmed as FingerprintKey : "";
}

function toolNameOf(tool: unknown): string {
  if (!isObject(tool)) return "";
  if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
  const fn = tool.function;
  return isObject(fn) && typeof fn.name === "string" ? fn.name.trim() : "";
}

function chatFunctionOf(tool: AnyRecord): AnyRecord | null {
  return isObject(tool.function) ? tool.function : null;
}

function isFingerprintDefinition(tool: AnyRecord, key: FingerprintKey): boolean {
  const def = chatFunctionOf(tool) || tool;
  const want = FINGERPRINT_TOOL_DEFINITIONS[key];
  return def.description === want.description && JSON.stringify(def.parameters) === JSON.stringify(want.parameters);
}

function withToolName(tool: AnyRecord, name: string): AnyRecord {
  const fn = chatFunctionOf(tool);
  return fn ? { ...tool, function: { ...fn, name } } : { ...tool, name };
}

/**
 * True when `tool` already speaks OpenCode's parameter names for `key`, so the
 * fingerprint definition can replace its own. The common case: OpenCode builds
 * `shell`'s description from `process.platform`, so the same tool on Windows
 * differs by two words from the captured definition.
 */
function canNormalizeInPlace(tool: AnyRecord, key: FingerprintKey): boolean {
  const def = chatFunctionOf(tool) || tool;
  const props = isObject(def.parameters) ? def.parameters.properties : null;
  if (!isObject(props)) return false;
  const want = FINGERPRINT_TOOL_DEFINITIONS[key].parameters;
  const wanted = Object.keys(want.properties);
  const declared = Object.keys(props);
  if (declared.some((name) => !wanted.includes(name))) return false;
  return want.required.every((name) => declared.includes(name));
}

function withFingerprintDefinition(tool: AnyRecord, key: FingerprintKey): AnyRecord {
  const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[key];
  const fn = chatFunctionOf(tool);
  return fn ? { ...tool, function: { ...fn, description, parameters } } : { ...tool, description, parameters };
}

/**
 * Keep caller tools on the fingerprint names when their arguments can carry
 * OpenCode's, and move the rest off them so the exact definitions can be
 * appended without a duplicate name. Case variants (`Read`) pass verbatim.
 * Returns the tools and a map sent name → original name.
 */
export function concealFingerprintToolNames<T>(tools: T): { tools: T; map: ToolMap } {
  const map: ToolMap = new Map();
  if (!Array.isArray(tools) || tools.length === 0) return { tools, map };
  const taken = new Set(tools.map(toolNameOf));
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const tool of tools as unknown[]) {
    if (!isObject(tool)) { out.push(tool); continue; }
    const key = fingerprintToolKey(toolNameOf(tool));
    if (!key) { out.push(tool); continue; }
    // Duplicate declarations of one name are rejected upstream; keep the first.
    if (seen.has(key)) continue;
    seen.add(key);
    if (isFingerprintDefinition(tool, key)) { out.push(tool); continue; }
    if (canNormalizeInPlace(tool, key)) { out.push(withFingerprintDefinition(tool, key)); continue; }
    let alias = `${key}_client`;
    for (let i = 2; taken.has(alias); i++) alias = `${key}_client${i}`;
    taken.add(alias);
    map.set(alias, key);
    out.push(withToolName(tool, alias));
  }
  return { tools: out as T, map };
}

/** Append OpenCode's definition for each fingerprint tool not declared yet; returns the appended names. */
export function appendMissingFingerprintTools(tools: unknown[], flat: boolean): string[] {
  const appended: string[] = [];
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (tools.some((tool) => fingerprintToolKey(toolNameOf(tool)) === name)) continue;
    const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[name];
    tools.push(flat
      ? { type: "function", name, description, parameters, strict: false }
      : { type: "function", function: { name, description, parameters } });
    appended.push(name);
  }
  return appended;
}

function aliasesByOriginal(map: ToolMap): ToolMap {
  return new Map([...map].map(([alias, original]) => [original, alias]));
}

/** Point an explicit tool_choice at the alias of a concealed caller tool. */
export function retargetToolChoice(body: unknown, map: ToolMap | null | undefined): void {
  if (!isObject(body) || !map?.size) return;
  const choice = body.tool_choice;
  if (!isObject(choice)) return;
  const aliases = aliasesByOriginal(map);
  if (typeof choice.name === "string") {
    const alias = aliases.get(choice.name.trim());
    if (alias) body.tool_choice = { ...choice, name: alias };
    return;
  }
  const fn = choice.function;
  if (isObject(fn) && typeof fn.name === "string") {
    const alias = aliases.get(fn.name.trim());
    if (alias) body.tool_choice = { ...choice, function: { ...fn, name: alias } };
  }
}

/** Rename prior-turn calls to concealed tools too, so the model does not read them as OpenCode's. */
export function aliasHistoryToolCalls(body: unknown, map: ToolMap | null | undefined): void {
  if (!isObject(body) || !map?.size) return;
  const aliases = aliasesByOriginal(map);
  if (Array.isArray(body.input)) {
    body.input = (body.input as unknown[]).map((item) =>
      isObject(item) && item.type === "function_call" && typeof item.name === "string" && aliases.has(item.name)
        ? { ...item, name: aliases.get(item.name) }
        : item);
  }
  if (Array.isArray(body.messages)) {
    body.messages = (body.messages as unknown[]).map((msg) => {
      if (!isObject(msg) || !Array.isArray(msg.tool_calls)) return msg;
      return {
        ...msg,
        tool_calls: (msg.tool_calls as unknown[]).map((call) => {
          const fn = isObject(call) && isObject(call.function) ? call.function : null;
          return fn && typeof fn.name === "string" && aliases.has(fn.name)
            ? { ...(call as AnyRecord), function: { ...fn, name: aliases.get(fn.name) } }
            : call;
        }),
      };
    });
  }
}

/** Append `text` to a system prompt held as a string, text blocks, or unset. */
function appendSystemText(system: unknown, text: string): unknown {
  if (typeof system === "string") return system.trim() ? `${system}\n\n${text}` : text;
  const blocks: unknown[] = Array.isArray(system) ? [...system] : [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (isObject(block) && typeof block.text === "string") {
      blocks[i] = { ...block, text: block.text.trim() ? `${block.text}\n\n${text}` : text };
      return blocks;
    }
  }
  return [...blocks, { type: "text", text }];
}

// The model does call the appended tools unless told not to; upstream does not
// gate on this text. Wording matters: "not available" made the model refuse the
// caller's own Read/Bash too.
function noteUnavailableTools(body: AnyRecord, flat: boolean, names: string[], claude: boolean): void {
  const list = names.map((name) => `\`${name}\``).join(" or ");
  const note = names.length > 1
    ? `Do not call the ${list} tools; they are placeholders that do nothing. Use the other tools you have been given instead.`
    : `Do not call the ${list} tool; it is a placeholder that does nothing. Use the other tools you have been given instead.`;
  if (flat) {
    body.instructions = typeof body.instructions === "string" && body.instructions.trim()
      ? `${body.instructions}\n\n${note}`
      : note;
    return;
  }
  // Claude-shaped bodies carry `system`; /messages rejects role:"system".
  if (claude || body.system !== undefined) { body.system = appendSystemText(body.system, note); return; }
  if (!Array.isArray(body.messages)) return;
  const [first, ...rest] = body.messages as AnyRecord[];
  body.messages = first?.role === "system" && typeof first.content === "string"
    ? [{ ...first, content: `${first.content}\n\n${note}` }, ...rest]
    : [{ role: "system", content: note }, ...(body.messages as unknown[])];
}

// The marker gate reads text only: a foreign system prompt plus this exact block
// passes, so it is appended to the caller's prompt rather than replacing it.
const ENV_TAG = "<env>";
const ENV_WORKING_DIR = process.cwd();
const ENV_FINGERPRINT_PROMPT = [
  "Here is some useful information about the environment you are running in:",
  ENV_TAG,
  `  Working directory: ${ENV_WORKING_DIR}`,
  `  Workspace root folder: ${ENV_WORKING_DIR}`,
  "  Is directory a git repo: no",
  `  Platform: ${process.platform}`,
  `  Prefer ${path.join(os.tmpdir(), "opencode")} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
  "</env>",
].join("\n");

function carriesEnv(system: unknown): boolean {
  if (typeof system === "string") return system.includes(ENV_TAG);
  return Array.isArray(system) && system.some((block) => isObject(block) && typeof block.text === "string" && block.text.includes(ENV_TAG));
}

/**
 * Append the CLI's environment marker to whichever system prompt the shape
 * uses: Responses `instructions`, Claude `system`, or a chat system message.
 * A genuine OpenCode client already carries it and is left alone.
 */
export function applyEnvFingerprint(body: unknown, flat: boolean, { claude = false } = {}): boolean {
  if (!isObject(body)) return false;
  if (flat) {
    if (body.instructions !== undefined && typeof body.instructions !== "string") return false;
    if (carriesEnv(body.instructions)) return false;
    body.instructions = typeof body.instructions === "string" && body.instructions.trim()
      ? `${body.instructions}\n\n${ENV_FINGERPRINT_PROMPT}`
      : ENV_FINGERPRINT_PROMPT;
    return true;
  }
  if (claude || body.system !== undefined) {
    if (carriesEnv(body.system)) return false;
    body.system = appendSystemText(body.system, ENV_FINGERPRINT_PROMPT);
    return true;
  }
  if (!Array.isArray(body.messages)) return false;
  const messages = body.messages as AnyRecord[];
  const idx = messages.findIndex((msg) => isObject(msg) && msg.role === "system");
  if (idx < 0) {
    body.messages = [{ role: "system", content: ENV_FINGERPRINT_PROMPT }, ...messages];
    return true;
  }
  if (carriesEnv(messages[idx].content)) return false;
  const content = appendSystemText(messages[idx].content, ENV_FINGERPRINT_PROMPT);
  body.messages = messages.map((msg, i) => (i === idx ? { ...msg, content } : msg));
  return true;
}

/**
 * Full request-side pass: alias conflicting caller tools, append OpenCode's
 * definitions, tell the model the appended ones are off-limits and add the
 * `<env>` marker. Returns the rename map (sent name → caller name).
 */
export function applyFingerprintTools(body: unknown, flat: boolean, { claude = false } = {}): ToolMap {
  const empty: ToolMap = new Map();
  if (!isObject(body)) return empty;
  try {
    const { tools, map } = concealFingerprintToolNames(body.tools);
    const list: unknown[] = Array.isArray(tools) ? tools : [];
    body.tools = list;
    const appended = appendMissingFingerprintTools(list, flat);
    retargetToolChoice(body, map);
    aliasHistoryToolCalls(body, map);
    if (appended.length) noteUnavailableTools(body, flat, appended, claude);
    applyEnvFingerprint(body, flat, { claude });
    // Never default to "none": upstream answers tool_choice "none" with 403.
    if (!body.tool_choice && flat) body.tool_choice = "auto";
    recordRenamedToolNames(body, map);
    return map;
  } catch {
    return empty;
  }
}

/** Anchor the rename map to the body object the response handlers will see. */
export function recordRenamedToolNames(body: unknown, map: ToolMap | null | undefined): void {
  if (!isObject(body) || !map?.size) return;
  renamedToolNames.set(body, map);
}

/** Rename map anchored to this body by applyFingerprintTools, if any. */
export function takeRenamedToolNames(body: unknown): ToolMap | null {
  if (!isObject(body)) return null;
  return renamedToolNames.get(body) || null;
}

/**
 * Restore caller tool names on a provider-side payload (stream event, chunk or
 * full body): Claude content_block_start/content[], OpenAI choices
 * delta/message tool_calls, Responses output[]/item. Returns the payload
 * untouched when nothing matches.
 */
export function restoreToolNames<T>(payload: T, map: ToolMap | null | undefined): T {
  if (!map?.size || payload == null) return payload;
  try {
    return restoreNames(payload as unknown, map) as T;
  } catch {
    return payload;
  }
}

function restoreNames(payload: unknown, map: ToolMap): unknown {
  if (Array.isArray(payload)) {
    let changed = false;
    const out = (payload as unknown[]).map((item) => {
      const next = restoreNames(item, map);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : payload;
  }
  if (!isObject(payload)) return payload;
  let out: AnyRecord = payload;
  const put = (key: string, value: unknown) => { if (out === payload) out = { ...payload }; out[key] = value; };
  if (payload.type === "content_block_start") {
    const block = payload.content_block;
    if (isObject(block) && block.type === "tool_use" && typeof block.name === "string" && map.has(block.name)) {
      put("content_block", { ...block, name: map.get(block.name) });
    }
  }
  if (Array.isArray(payload.content)) {
    let changed = false;
    const content = (payload.content as unknown[]).map((block) => {
      if (isObject(block) && block.type === "tool_use" && typeof block.name === "string" && map.has(block.name)) {
        changed = true;
        return { ...block, name: map.get(block.name) };
      }
      return block;
    });
    if (changed) put("content", content);
  }
  if (Array.isArray(payload.choices)) {
    let anyChanged = false;
    const choices = (payload.choices as unknown[]).map((choice) => {
      if (!isObject(choice)) return choice;
      let changed = false;
      const next: AnyRecord = { ...choice };
      for (const holder of ["delta", "message"]) {
        const value = choice[holder];
        if (!isObject(value) || !Array.isArray(value.tool_calls) || (value.tool_calls as unknown[]).length === 0) continue;
        const calls = (value.tool_calls as unknown[]).map((call) => {
          const rec = isObject(call) ? call : null;
          const name = rec ? (rec.function as AnyRecord | undefined)?.name : undefined;
          if (typeof name === "string" && map.has(name)) {
            changed = true;
            const fn = rec?.function as AnyRecord;
            return { ...rec, function: { ...fn, name: map.get(name) } };
          }
          return call;
        });
        next[holder] = { ...value, tool_calls: calls };
      }
      if (changed) anyChanged = true;
      return changed ? next : choice;
    });
    if (anyChanged) put("choices", choices);
  }
  if (Array.isArray(payload.output)) {
    let changed = false;
    const output = (payload.output as unknown[]).map((item) => {
      if (isObject(item) && item.type === "function_call" && typeof item.name === "string" && map.has(item.name)) {
        changed = true;
        return { ...item, name: map.get(item.name) };
      }
      return item;
    });
    if (changed) put("output", output);
  }
  const item = payload.item;
  if (isObject(item) && item.type === "function_call" && typeof item.name === "string" && map.has(item.name)) {
    put("item", { ...item, name: map.get(item.name) });
  }
  return out;
}
