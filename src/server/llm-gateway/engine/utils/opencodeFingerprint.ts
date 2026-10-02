/**
 * OpenCode free-tier client fingerprint (console.opencode.ai gate).
 *
 * The upstream free tier only answers requests that look like they come from
 * the official OpenCode client. One part of that fingerprint is the canonical
 * tools quartet (bash, glob, grep, read) always present in the request body,
 * spelled exactly like the client spells them. Anything the caller declared
 * with one of those names under a different spelling (Bash, Grep, …) is
 * renamed to the canonical key before dispatch and restored in the response,
 * so the caller keeps seeing its own tool names.
 *
 * Fail-open by design: every entry point degrades to "leave the payload alone"
 * instead of throwing — a fingerprint mismatch costs a 403 upstream, while a
 * throw here would take down the whole chat request.
 *
 * TypeScript port of the reference fix (decolua/9router v0.5.81).
 */

/** Canonical names required by the upstream free-tier gate. */
export const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];

type ToolMap = Map<string, string>;
type AnyRecord = Record<string, unknown>;

const renamedToolNames = new WeakMap<object, ToolMap>();

/** Canonical key for a fingerprint tool name, or "" when it is not one. */
export function fingerprintToolKey(name: unknown): string {
  const lower = String(name ?? "").trim().toLowerCase();
  return OPENCODE_FINGERPRINT_TOOLS.includes(lower) ? lower : "";
}

function isObject(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toolNameOf(tool: unknown): string {
  if (!isObject(tool)) return "";
  if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
  const fn = tool.function;
  if (isObject(fn) && typeof fn.name === "string") {
    return fn.name.trim();
  }
  return "";
}

/**
 * Rename every fingerprint tool to its canonical key (Bash → bash), dropping
 * duplicates of the same key (Bash + bash → one bash). Maps canonical key →
 * original caller name for the response-side restore.
 */
export function concealFingerprintToolNames<T>(tools: T): { tools: T; map: ToolMap } {
  const map: ToolMap = new Map();
  if (!Array.isArray(tools) || tools.length === 0) return { tools, map };
  const seenQuartet = new Set<string>();
  const out: unknown[] = [];
  for (const tool of tools as unknown[]) {
    if (!isObject(tool)) { out.push(tool); continue; }
    const current = toolNameOf(tool);
    const key = fingerprintToolKey(current);
    if (!key) { out.push(tool); continue; }
    if (seenQuartet.has(key)) continue; // Bash + bash rejected upstream as a duplicate
    seenQuartet.add(key);
    if (current !== key) {
      map.set(key, current);
      const fn = isObject(tool.function) ? tool.function : null;
      out.push(fn ? { ...tool, function: { ...fn, name: key } } : { ...tool, name: key });
    } else {
      out.push(tool);
    }
  }
  return { tools: out as T, map };
}

/**
 * Append any quartet member the body is missing, as an unavailable decoy.
 * `flat` selects the Responses/Claude shape ({ name }) over the chat shape
 * ({ function: { name } }).
 */
export function appendMissingFingerprintTools<T>(tools: T, flat: boolean): T {
  const list = Array.isArray(tools) ? (tools as unknown[]) : [];
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (list.some((tool) => fingerprintToolKey(toolNameOf(tool)) === name)) continue;
    list.push(flat ? {
      type: "function", name,
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    } : {
      type: "function",
      function: { name, description: "This tool is currently unavailable and must not be used.", parameters: { type: "object", properties: {} } },
    });
  }
  return list as T;
}

/** Point a forced tool_choice at the canonical name we actually sent. */
export function retargetToolChoice(body: unknown, map: ToolMap | null | undefined): void {
  if (!isObject(body) || !map?.size) return;
  const choice = body.tool_choice;
  if (!isObject(choice)) return;
  if (typeof choice.name === "string") {
    const key = fingerprintToolKey(choice.name);
    if (key && map.has(key)) body.tool_choice = { ...choice, name: key };
    return;
  }
  const fn = choice.function;
  if (isObject(fn) && typeof fn.name === "string") {
    const key = fingerprintToolKey(fn.name);
    if (key && map.has(key)) body.tool_choice = { ...choice, function: { ...fn, name: key } };
  }
}

/**
 * Full request-side fingerprint: canonicalize + complete the tools quartet,
 * retarget tool_choice and default it when absent. Returns the rename map
 * (canonical key → caller name) for the response-side restore.
 */
export function applyFingerprintTools(body: unknown, flat: boolean): ToolMap {
  const empty: ToolMap = new Map();
  if (!isObject(body)) return empty;
  try {
    const hadClientTools = Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;
    const { tools, map } = concealFingerprintToolNames(body.tools);
    body.tools = appendMissingFingerprintTools(tools, flat);
    retargetToolChoice(body, map);
    if (!body.tool_choice) {
      if (flat) body.tool_choice = "auto";
      else if (!hadClientTools) body.tool_choice = "none";
    }
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
