import {
  KIRO_TOOL_DESCRIPTION_MAX_LENGTH,
  KIRO_TOOL_ID_MAX_LENGTH,
  KIRO_TOOL_NAME_MAX_LENGTH,
} from "../../config/kiroConstants";
import type { KiroTurn, KiroToolSpec, KiroRepairs, KiroToolUse, KiroToolResult, KiroUserInputMessage, KiroAssistantResponseMessage } from "./openaiTypes";

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOOL_NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

function clone<T>(value: T): T;
function clone(value: null | undefined): typeof value;
function clone(value: unknown): unknown {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendText(target: { content?: string }, extra: string | undefined | null): void {
  if (!extra) return;
  target.content = target.content ? `${target.content}\n\n${extra}` : extra;
}

function trimCodePoints(value: unknown, limit: number): string {
  return [...String(value || "")].slice(0, limit).join("");
}

function uniqueName(rawName: unknown, index: number, usedNames: Set<string>): string {
  const cleaned = String(rawName || "")
    .trim()
    .replace(TOOL_NAME_PATTERN, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = trimCodePoints(cleaned || `tool_${index + 1}`, KIRO_TOOL_NAME_MAX_LENGTH);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, KIRO_TOOL_NAME_MAX_LENGTH - tail.length)}${tail}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function cleanSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchemaValue);
  if (!value || typeof value !== "object") return value;

  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "additionalProperties") continue;
    if (key === "required" && Array.isArray(child) && child.length === 0) continue;
    cleaned[key] = cleanSchemaValue(child);
  }
  return cleaned;
}

function normalizeRootSchema(schema: unknown): Record<string, unknown> {
  const cleaned = cleanSchemaValue(schema && typeof schema === "object" ? clone(schema) : {}) as Record<string, unknown>;
  cleaned.type = "object";
  if (!cleaned.properties || typeof cleaned.properties !== "object" || Array.isArray(cleaned.properties)) {
    cleaned.properties = {};
  }
  if (Array.isArray(cleaned.required)) {
    const filtered = (cleaned.required as unknown[]).filter(
      (name: unknown) => typeof name === "string" && Object.hasOwn(cleaned.properties as object, name as string)
    );
    cleaned.required = [...new Set(filtered)];
    if ((cleaned.required as unknown[]).length === 0) delete cleaned.required;
  }
  return cleaned;
}

/** Normalize OpenAI- or Claude-shaped tool definitions into Kiro tool specs. */
export function normalizeKiroToolSpecs(tools: unknown): { specs: KiroToolSpec[]; nameMap: Map<string, string> } {
  const specs: KiroToolSpec[] = [];
  const nameMap = new Map<string, string>();
  const usedNames = new Set<string>();

  for (const [index, tool] of (Array.isArray(tools) ? tools : []).entries()) {
    if (!tool || typeof tool !== "object") continue;
    const t = tool as Record<string, unknown>;
    const fn = t.function as Record<string, unknown> | undefined;
    const rawName = fn?.name ?? t.name;
    if (typeof rawName !== "string" || !rawName.trim()) continue;

    // A repeated definition with the same source name describes the same tool.
    if (nameMap.has(rawName)) continue;
    const name = uniqueName(rawName, index, usedNames);
    nameMap.set(rawName, name);

    const rawDescription = fn?.description ?? t.description ?? `Tool: ${rawName}`;
    const description = trimCodePoints(
      String(rawDescription || `Tool: ${rawName}`),
      KIRO_TOOL_DESCRIPTION_MAX_LENGTH
    );
    const schema = fn?.parameters ?? t.parameters ?? t.input_schema ?? {};
    specs.push({
      toolSpecification: {
        name,
        description,
        inputSchema: { json: normalizeRootSchema(schema) },
      },
    });
  }

  return { specs, nameMap };
}

function toolCallText(toolUse: KiroToolUse | undefined): string {
  return `[Tool call: ${toolUse?.name || "unknown"}(${text(toolUse?.input || {})})]`;
}

function toolResultText(toolResult: KiroToolResult | undefined): string {
  const content = Array.isArray(toolResult?.content)
    ? (toolResult.content as Record<string, unknown>[]).map((part) => text((part as Record<string, unknown>)?.text ?? part)).filter(Boolean).join("\n")
    : text(toolResult?.content);
  return `[Tool result${toolResult?.status === "error" ? " (error)" : ""}: ${content}]`;
}

function mergeUser(target: KiroUserInputMessage, source: KiroUserInputMessage): void {
  appendText(target, source.content);
  if (Array.isArray(source.images) && source.images.length > 0) {
    target.images = [...(target.images || []), ...source.images];
  }
  const results = source.userInputMessageContext?.toolResults;
  if (Array.isArray(results) && results.length > 0) {
    target.userInputMessageContext ||= {};
    target.userInputMessageContext.toolResults = [
      ...(target.userInputMessageContext.toolResults || []),
      ...results,
    ];
  }
}

function mergeAssistant(target: KiroAssistantResponseMessage, source: KiroAssistantResponseMessage): void {
  appendText(target, source.content);
  if (Array.isArray(source.toolUses) && source.toolUses.length > 0) {
    target.toolUses = [...(target.toolUses || []), ...source.toolUses];
  }
}

function ensureAlternatingBoundaries(turns: KiroTurn[], modelId: string): void {
  if (turns[0]?.assistantResponseMessage) {
    turns.unshift({ userInputMessage: { content: "continue", modelId } });
  }
  if (turns.length === 0 || turns[turns.length - 1]?.assistantResponseMessage) {
    turns.push({ userInputMessage: { content: "continue", modelId } });
  }
}

function cleanupTurns(turns: KiroTurn[], modelId: string): void {
  for (const turn of turns) {
    if (turn.userInputMessage) {
      turn.userInputMessage.content = text(turn.userInputMessage.content).trim() || "continue";
      turn.userInputMessage.modelId ||= modelId;
      if (turn.userInputMessage.userInputMessageContext?.tools) {
        delete turn.userInputMessage.userInputMessageContext.tools;
      }
    } else {
      turn.assistantResponseMessage!.content =
        text(turn.assistantResponseMessage!.content).trim() || "...";
    }
  }
}

function normalizeTurns(history: unknown, currentMessage: unknown, modelId: string): KiroTurn[] {
  const rawTurns = [...(Array.isArray(history) ? history : [])];
  if (currentMessage) rawTurns.push(currentMessage);
  const turns: KiroTurn[] = [];

  for (const raw of rawTurns) {
    const r = raw as KiroTurn;
    const isUser = !!r?.userInputMessage;
    const isAssistant = !!r?.assistantResponseMessage;
    if (isUser === isAssistant) continue;

    const turn: KiroTurn = isUser
      ? { userInputMessage: clone(r.userInputMessage) }
      : { assistantResponseMessage: clone(r.assistantResponseMessage) };
    const previous = turns[turns.length - 1];
    if (turn.userInputMessage && previous?.userInputMessage) {
      mergeUser(previous.userInputMessage, turn.userInputMessage);
    } else if (turn.assistantResponseMessage && previous?.assistantResponseMessage) {
      mergeAssistant(previous.assistantResponseMessage, turn.assistantResponseMessage);
    } else {
      turns.push(turn);
    }
  }

  ensureAlternatingBoundaries(turns, modelId);
  cleanupTurns(turns, modelId);
  return turns;
}

function rawId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function reserveToolId(value: unknown, turnIndex: number, callIndex: number, name: string | undefined, usedIds: Set<string>): string {
  const sanitized = rawId(value).replace(/[^a-zA-Z0-9_-]/g, "");
  const generated = `call_msg${turnIndex}_tc${callIndex}_${name || "tool"}`;
  const base = trimCodePoints(
    TOOL_ID_PATTERN.test(sanitized) && sanitized ? sanitized : generated,
    KIRO_TOOL_ID_MAX_LENGTH
  );
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, KIRO_TOOL_ID_MAX_LENGTH - tail.length)}${tail}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeToolInput(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) return clone(input) as Record<string, unknown>;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return input == null ? {} : null;
}

function normalizeToolResult(result: KiroToolResult): KiroToolResult {
  const content = Array.isArray(result?.content)
    ? (result.content as unknown[]).map((part) => ({ text: text((part as Record<string, unknown>)?.text ?? part) }))
    : [{ text: text(result?.content) }];
  return {
    toolUseId: rawId(result?.toolUseId),
    status: result?.status === "error" ? "error" : "success",
    content: content.length > 0 ? content : [{ text: "" }],
  };
}

function flattenResults(userMessage: KiroUserInputMessage, results: KiroToolResult[]): void {
  for (const result of results) appendText(userMessage, toolResultText(result));
}

function cleanUserContext(userMessage: KiroUserInputMessage): void {
  const context = userMessage.userInputMessageContext;
  if (!context) return;
  if (!context.toolResults?.length) delete context.toolResults;
  if (!context.tools?.length) delete context.tools;
  if (Object.keys(context).length === 0) delete userMessage.userInputMessageContext;
}

interface CallRecord {
  call: KiroToolUse;
  callIndex: number;
  key: string;
  mappedName: string | undefined;
  input: Record<string, unknown> | null;
  result: KiroToolResult | null;
}

function buildCallRecords(
  calls: KiroToolUse[],
  nameMap: Map<string, string>,
): { callRecords: CallRecord[]; callQueues: Map<string, CallRecord[]> } {
  const callQueues = new Map<string, CallRecord[]>();
  const callRecords: CallRecord[] = calls.map((call, callIndex) => {
    const key = rawId(call?.toolUseId);
    const mappedName = nameMap.get(call?.name ?? "") || call?.name;
    const input = normalizeToolInput(call?.input);
    const record: CallRecord = { call, callIndex, key, mappedName, input, result: null };
    const queue = callQueues.get(key) || [];
    queue.push(record);
    callQueues.set(key, queue);
    return record;
  });
  return { callRecords, callQueues };
}

function matchResultsToCalls(
  results: KiroToolResult[],
  callQueues: Map<string, CallRecord[]>,
): KiroToolResult[] {
  const orphanResults: KiroToolResult[] = [];
  for (const result of results) {
    const queue = callQueues.get(rawId(result.toolUseId));
    const record = queue?.find((candidate) => !candidate.result);
    if (record) record.result = result;
    else orphanResults.push(result);
  }
  return orphanResults;
}

function collectKeptPairs(
  callRecords: CallRecord[],
  turnIndex: number,
  specNames: Set<string>,
  usedIds: Set<string>,
  assistant: KiroAssistantResponseMessage,
  user: KiroUserInputMessage,
  repairs: KiroRepairs,
): { keptCalls: KiroToolUse[]; keptResults: KiroToolResult[] } {
  const keptCalls: KiroToolUse[] = [];
  const keptResults: KiroToolResult[] = [];
  for (const record of callRecords) {
    const hasSpec = typeof record.mappedName === "string" && specNames.has(record.mappedName);
    const valid = !!record.result && hasSpec && record.input !== null;
    if (!valid) {
      appendText(assistant, toolCallText({ name: record.mappedName, input: record.call?.input }));
      repairs.missingResults += record.result ? 0 : 1;
      repairs.invalidToolUses += hasSpec && record.input !== null ? 0 : 1;
      if (record.result) {
        flattenResults(user, [record.result]);
        repairs.orphanResults++;
      }
      continue;
    }

    const toolUseId = reserveToolId(
      record.key,
      turnIndex,
      record.callIndex,
      record.mappedName,
      usedIds
    );
    keptCalls.push({
      toolUseId,
      name: record.mappedName,
      input: record.input,
    });
    keptResults.push({ ...record.result!, toolUseId });
  }
  return { keptCalls, keptResults };
}

function reconcileToolPair(assistant: KiroAssistantResponseMessage, user: KiroUserInputMessage, turnIndex: number, nameMap: Map<string, string>, specNames: Set<string>, usedIds: Set<string>, repairs: KiroRepairs): void {
  const calls = Array.isArray(assistant.toolUses) ? assistant.toolUses : [];
  const results = Array.isArray(user.userInputMessageContext?.toolResults)
    ? user.userInputMessageContext.toolResults.map(normalizeToolResult)
    : [];
  if (calls.length === 0) {
    if (results.length > 0) {
      flattenResults(user, results);
      repairs.orphanResults += results.length;
    }
    if (user.userInputMessageContext) delete user.userInputMessageContext.toolResults;
    cleanUserContext(user);
    return;
  }

  const { callRecords, callQueues } = buildCallRecords(calls, nameMap);
  const orphanResults = matchResultsToCalls(results, callQueues);
  const { keptCalls, keptResults } = collectKeptPairs(callRecords, turnIndex, specNames, usedIds, assistant, user, repairs);

  if (orphanResults.length > 0) {
    flattenResults(user, orphanResults);
    repairs.orphanResults += orphanResults.length;
  }

  if (keptCalls.length > 0) assistant.toolUses = keptCalls;
  else delete assistant.toolUses;
  user.userInputMessageContext ||= {};
  if (keptResults.length > 0) user.userInputMessageContext.toolResults = keptResults;
  else delete user.userInputMessageContext.toolResults;
  cleanUserContext(user);
}

/** Validate the final Kiro wire conversation without mutating it. */
function validateKiroConversation(history: unknown, currentMessage: unknown, toolSpecs: KiroToolSpec[] = []): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const turns = [...(Array.isArray(history) ? history : []), currentMessage].filter(Boolean) as KiroTurn[];
  const specNames = new Set(toolSpecs.map((spec) => spec?.toolSpecification?.name).filter((n): n is string => typeof n === "string"));
  const usedIds = new Set<string>();

  for (let index = 0; index < turns.length; index++) {
    const expectedUser = index % 2 === 0;
    const isUser = !!turns[index]?.userInputMessage;
    if (isUser !== expectedUser) errors.push(`role:${index}`);
    if (!isUser) {
      const calls = turns[index].assistantResponseMessage?.toolUses || [];
      const results = turns[index + 1]?.userInputMessage?.userInputMessageContext?.toolResults || [];
      const callIds = calls.map((call) => call.toolUseId);
      const resultIds = results.map((result) => result.toolUseId);
      if (calls.length !== results.length || callIds.some((id) => !resultIds.includes(id))) {
        errors.push(`pair:${index}`);
      }
      for (const call of calls) {
        if (!call.toolUseId || usedIds.has(call.toolUseId)) errors.push(`id:${index}`);
        usedIds.add(call.toolUseId!);
        if (!specNames.has(call.name ?? "")) errors.push(`spec:${index}`);
      }
    } else if (index === 0) {
      const results = turns[index].userInputMessage?.userInputMessageContext?.toolResults;
      if (results?.length) errors.push("orphan:0");
    }
  }
  const cm = currentMessage as KiroTurn | undefined;
  if (!cm?.userInputMessage?.content) errors.push("current");
  return { valid: errors.length === 0, errors };
}

function flattenAllStructuredTools(turns: KiroTurn[], repairs: KiroRepairs): void {
  for (const turn of turns) {
    if (turn.assistantResponseMessage?.toolUses?.length) {
      for (const call of turn.assistantResponseMessage.toolUses) {
        appendText(turn.assistantResponseMessage, toolCallText(call));
      }
      repairs.invalidToolUses += turn.assistantResponseMessage.toolUses.length;
      delete turn.assistantResponseMessage.toolUses;
    }
    const user = turn.userInputMessage;
    const results = user?.userInputMessageContext?.toolResults;
    if (results?.length) {
      flattenResults(user!, results);
      repairs.orphanResults += results.length;
      delete user!.userInputMessageContext!.toolResults;
      cleanUserContext(user!);
    }
  }
}

interface CanonicalizeInput {
  history?: unknown;
  currentMessage?: unknown;
  modelId?: string;
  toolSpecs?: KiroToolSpec[];
  nameMap?: Map<string, string>;
}

interface CanonicalizeResult {
  history: KiroTurn[];
  currentMessage: KiroTurn;
  repairs: KiroRepairs;
  valid: boolean;
  errors: string[];
}

function reconcileAllTurns(turns: KiroTurn[], nameMap: Map<string, string>, specNames: Set<string>, usedIds: Set<string>, repairs: KiroRepairs): void {
  for (let index = 0; index < turns.length; index += 2) {
    const user = turns[index].userInputMessage!;
    if (index === 0) {
      const leadingResults = user.userInputMessageContext?.toolResults || [];
      if (leadingResults.length > 0) {
        flattenResults(user, leadingResults);
        repairs.orphanResults += leadingResults.length;
        delete user.userInputMessageContext!.toolResults;
        cleanUserContext(user);
      }
    }
    const assistant = turns[index + 1]?.assistantResponseMessage;
    const nextUser = turns[index + 2]?.userInputMessage;
    if (assistant && nextUser) {
      reconcileToolPair(assistant, nextUser, index + 1, nameMap, specNames, usedIds, repairs);
    }
  }
}

function finalizeCurrentMessage(turns: KiroTurn[], toolSpecs: KiroToolSpec[]): KiroTurn {
  const finalCurrent = turns[turns.length - 1];
  finalCurrent.userInputMessage!.userInputMessageContext ||= {};
  if (toolSpecs.length > 0) {
    finalCurrent.userInputMessage!.userInputMessageContext.tools = clone(toolSpecs) as unknown[];
  }
  cleanUserContext(finalCurrent.userInputMessage!);
  return finalCurrent;
}

/**
 * Produce a strict Kiro conversation: alternating turns, current user message,
 * adjacent one-to-one tool use/result pairs, and tool specs only on currentMessage.
 */
export function canonicalizeKiroConversation({
  history,
  currentMessage,
  modelId,
  toolSpecs = [],
  nameMap = new Map(),
}: CanonicalizeInput = {}): CanonicalizeResult {
  const turns = normalizeTurns(history, currentMessage, modelId ?? "");
  const repairs: KiroRepairs = { missingResults: 0, orphanResults: 0, invalidToolUses: 0 };
  const specNames = new Set(toolSpecs.map((spec) => spec?.toolSpecification?.name).filter((n): n is string => typeof n === "string"));
  const usedIds = new Set<string>();

  reconcileAllTurns(turns, nameMap, specNames, usedIds, repairs);

  const finalCurrent = finalizeCurrentMessage(turns, toolSpecs);

  let finalHistory = turns.slice(0, -1);
  let validation = validateKiroConversation(finalHistory, finalCurrent, toolSpecs);
  if (!validation.valid) {
    flattenAllStructuredTools(turns, repairs);
    finalHistory = turns.slice(0, -1);
    validation = validateKiroConversation(finalHistory, finalCurrent, toolSpecs);
  }

  return {
    history: finalHistory,
    currentMessage: finalCurrent,
    repairs,
    valid: validation.valid,
    errors: validation.errors,
  };
}
