// synapse: API pública — fail-open total (qualquer erro → null, nunca throw).
// Respostas determinísticas de custo-zero para padrões triviais pt-BR.
// Curto-circuita a chamada ao provider quando a última mensagem é um padrão
// inequívoco (saudação, agradecimento, despedida, etc.).

import { synapseDeterministicData } from "./data";
import { SynapseDeterministicBot } from "./engine";
import { PROVIDER_ID_TO_ALIAS, getModelType } from "../../config/providerModels";
import { createStreamingResponse, createNonStreamingResponse } from "../../utils/localResponse";
import { TOKEN_SAVERS_APPLIED_HEADER } from "../appliedHeader";

// ── normalize ──────────────────────────────────────────────────────────────
export function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ── singletons: lazy, module-level ─────────────────────────────────────────
let liteBot: SynapseDeterministicBot | null = null;
let fullBot: SynapseDeterministicBot | null = null;

function getLiteBot(): SynapseDeterministicBot {
  if (!liteBot) {
    const liteData = {
      ...synapseDeterministicData,
      keywords: synapseDeterministicData.keywords.filter((k) => k.level === "lite"),
    };
    liteBot = new SynapseDeterministicBot(liteData, { memorySize: 20 });
  }
  return liteBot;
}

function getFullBot(): SynapseDeterministicBot {
  if (!fullBot) {
    fullBot = new SynapseDeterministicBot(synapseDeterministicData, { memorySize: 20 });
  }
  return fullBot;
}

// ── matchSynapseDeterministic ──────────────────────────────────────────────
export function matchSynapseDeterministic(text: string, level: string): string | null {
  const norm = normalize(text);
  if (!norm || norm.length > 120) {
    return null;
  }
  // O engine responde à primeira frase que casa: "oi. qual a capital da
  // França?" virava só "Olá!". Mais de uma frase nunca é trivial.
  if (norm.split(/[!.;?]+/).filter((s) => s.trim()).length > 1) {
    return null;
  }
  const bot = level === "full" ? getFullBot() : getLiteBot();
  return bot.transform(norm);
}

// ── trySynapseIntercept ────────────────────────────────────────────────────
interface SynapseInterceptParams {
  body: Record<string, unknown>;
  sourceFormat: string;
  stream: boolean;
  model: string;
  provider: string;
  enabled: boolean;
  level?: string;
  log?: { line?: (...args: unknown[]) => void };
  reqTag: string;
}

type SynapseResult = { success: true; response: Response } | null;

export function trySynapseIntercept(params: SynapseInterceptParams): SynapseResult {
  try {
    const { body, sourceFormat, stream, model, provider, enabled, level, log, reqTag } = params;
    if (!enabled) return null;
    const text = synapseEligibleText({ body, model, provider });
    if (!text) return null;

    const match = matchSynapseDeterministic(text, level || "lite");
    if (!match) return null;

    log?.line?.(reqTag, "⚙", `SYNAPSE:${level || "lite"}`);
    return synapseLocalResponse(sourceFormat, stream, model, match);
  } catch {
    // synapse: fail-open — qualquer erro → null
    return null;
  }
}

/** A local answer in the client's dialect, tagged so the chat shows the Synapse pill. */
export function synapseLocalResponse(sourceFormat: string, stream: boolean, model: string, text: string): { success: true; response: Response } {
  const synapseHeaders = { "X-ModelHub-Response-Source": "synapse", [TOKEN_SAVERS_APPLIED_HEADER]: "synapse" };
  const result = stream
    ? createStreamingResponse(sourceFormat, model, text, synapseHeaders)
    : createNonStreamingResponse(sourceFormat, model, text, synapseHeaders);
  return { success: true as const, response: result.response };
}

/**
 * The user's text when this turn is one Synapse may answer locally — shared by
 * the fixed patterns and the Synapse Loop (which also observes only these
 * turns). Null for anything that isn't a plain, self-contained user message.
 */
export function synapseEligibleText({ body, model, provider }: { body: Record<string, unknown>; model: string; provider: string }): string | null {
  // imageGen model (espelha resolveStreamMode phases.ts:129-131)
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  if (getModelType(alias, model) === "imageGen" || /image|imagen|image-generation/i.test(model)) return null;

  const messages = Array.isArray(body.messages) ? body.messages as unknown[] : null;
  const input = Array.isArray(body.input) ? body.input as unknown[] : null;
  const contents = Array.isArray(body.contents) ? body.contents as unknown[] : null;
  const msgList = messages || input || contents;
  if (!msgList || msgList.length === 0) return null;

  // Última mensagem deve ser do usuário
  const lastMsg = msgList[msgList.length - 1] as Record<string, unknown>;
  if (!lastMsg) return null;
  const isUser = input
    // openai-responses: item.role === "user" OU item.type === "message" com role user
    ? lastMsg.role === "user" || (lastMsg.type === "message" && lastMsg.role === "user")
    : lastMsg.role === "user";
  if (!isUser) return null;

  const text = extractText(lastMsg, contents !== null);
  if (!text) return null;

  // Tools presentes não bloqueiam: o chat manda `tools` sempre que a
  // conversa tem plugins ligados, não porque o turno precise delas. Só um
  // pedido que OBRIGA uma tool deixa de ser uma saudação trivial.
  if (forcesToolCall(body)) return null;

  // SEM atividade de tool no histórico
  if (hasToolActivity(msgList, contents !== null)) return null;

  // "ok"/"certo" depois de uma pergunta do assistente é resposta a ela
  // ("Quer que eu inclua compressão?" → "ok"), não um ack para agradecer.
  const prevMsg = msgList[msgList.length - 2] as Record<string, unknown> | undefined;
  if (prevMsg && (prevMsg.role === "assistant" || prevMsg.role === "model")) {
    const prevText = extractText(prevMsg, contents !== null);
    if (prevText?.trim().endsWith("?")) return null;
  }
  return text;
}

/** The request's system instructions in any dialect, or null. */
export function systemTextOf(body: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) for (const v of value) push((v as Record<string, unknown>)?.text ?? v);
    else if (value && typeof value === "object") push((value as Record<string, unknown>).parts ?? (value as Record<string, unknown>).text);
  };
  push(body.system);
  push(body.instructions);
  push(body.systemInstruction);
  for (const m of [...(Array.isArray(body.messages) ? body.messages : []), ...(Array.isArray(body.input) ? body.input : [])] as Array<Record<string, unknown>>) {
    if (m?.role === "system" || m?.role === "developer") push(m.content);
  }
  const text = parts.filter((p) => typeof p === "string" && p.trim()).join("\n\n");
  return text || null;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Extrai texto de uma mensagem (defensivo para todos os formatos). */
function extractText(msg: Record<string, unknown>, isGemini: boolean): string | null {
  // string direta
  if (typeof msg.content === "string" && msg.content.trim()) return msg.content;

  // array de blocos (Claude/OpenAI)
  if (Array.isArray(msg.content)) {
    const parts = msg.content
      .filter((b: unknown) => (b as Record<string, unknown>)?.type === "text")
      .map((b: unknown) => (b as Record<string, unknown>).text)
      .filter((t: unknown) => typeof t === "string");
    if (parts.length > 0) return parts.join(" ");
  }

  // gemini: parts[].text
  if (isGemini && Array.isArray(msg.parts)) {
    const parts = (msg.parts as unknown[])
      .map((p: unknown) => (p as Record<string, unknown>).text)
      .filter((t: unknown) => typeof t === "string");
    if (parts.length > 0) return parts.join(" ");
  }

  // openai-responses: content string ou parts input_text/text
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray((msg as Record<string, unknown>).input)) {
    const inputParts = ((msg as Record<string, unknown>).input as unknown[])
      .map((p: unknown) => {
        const part = p as Record<string, unknown>;
        if (typeof part.text === "string") return part.text;
        if (part.type === "input_text" && typeof part.text === "string") return part.text;
        return null;
      })
      .filter((t: unknown) => typeof t === "string");
    if (inputParts.length > 0) return inputParts.join(" ");
  }

  return null;
}

/** tool_choice / function_call / toolConfig que exigem uma chamada de tool. */
function forcesToolCall(body: Record<string, unknown>): boolean {
  const choice = body.tool_choice ?? body.function_call;
  if (choice && typeof choice === "object") {
    const type = (choice as Record<string, unknown>).type;
    return type !== "auto" && type !== "none";
  }
  if (choice === "required" || choice === "any") return true;
  const mode = ((body.toolConfig as Record<string, unknown> | undefined)?.functionCallingConfig as Record<string, unknown> | undefined)?.mode;
  return mode === "ANY";
}

/** Verifica se há atividade de tool em qualquer mensagem do histórico. */
function hasToolActivity(msgList: unknown[], isGemini: boolean): boolean {
  for (const msg of msgList) {
    const m = msg as Record<string, unknown>;
    if (!m) continue;

    // OpenAI: role "tool"
    if (m.role === "tool") return true;

    // Claude: blocos content type "tool_use" / "tool_result"
    if (Array.isArray(m.content)) {
      for (const block of m.content as unknown[]) {
        const b = block as Record<string, unknown>;
        if (b?.type === "tool_use" || b?.type === "tool_result") return true;
      }
    }

    // openai-responses: input items type "function_call" / "function_call_output"
    if (m.type === "function_call" || m.type === "function_call_output") return true;

    // Gemini: parts functionCall/functionResponse
    if (isGemini && Array.isArray(m.parts)) {
      for (const part of m.parts as unknown[]) {
        const p = part as Record<string, unknown>;
        if (p?.functionCall || p?.functionResponse) return true;
      }
    }
  }
  return false;
}
