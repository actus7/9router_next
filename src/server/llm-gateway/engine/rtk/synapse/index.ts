// synapse: API pública — fail-open total (qualquer erro → null, nunca throw).
// Respostas determinísticas de custo-zero para padrões triviais pt-BR.
// Curto-circuita a chamada ao provider quando a última mensagem é um padrão
// inequívoco (saudação, agradecimento, despedida, etc.).

import { synapseDeterministicData } from "./data";
import { SynapseDeterministicBot } from "./engine";
import { PROVIDER_ID_TO_ALIAS, getModelType } from "../../config/providerModels";
import { createStreamingResponse, createNonStreamingResponse } from "../../utils/localResponse";

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

    // 1. Guard: disabled
    if (!enabled) return null;

    // 2. Guard: imageGen model (espelha resolveStreamMode phases.ts:129-131)
    const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
    const modelType = getModelType(alias, model);
    if (modelType === "imageGen" || /image|imagen|image-generation/i.test(model)) {
      return null;
    }

    // 3. Extrair lista de mensagens format-aware
    const messages = Array.isArray(body.messages) ? body.messages as unknown[] : null;
    const input = Array.isArray(body.input) ? body.input as unknown[] : null;
    const contents = Array.isArray(body.contents) ? body.contents as unknown[] : null;
    const msgList = messages || input || contents;
    if (!msgList || msgList.length === 0) return null;

    // 4. Última mensagem deve ser do usuário
    const lastMsg = msgList[msgList.length - 1] as Record<string, unknown>;
    if (!lastMsg) return null;

    let isUser = false;
    if (messages) {
      isUser = lastMsg.role === "user";
    } else if (contents) {
      isUser = lastMsg.role === "user";
    } else if (input) {
      // openai-responses: item.role === "user" OU item.type === "message" com role user
      isUser = lastMsg.role === "user" || (lastMsg.type === "message" && (lastMsg as Record<string, unknown>).role === "user");
    }
    if (!isUser) return null;

    // 5. Extrair texto da última mensagem (defensivo)
    const text = extractText(lastMsg, contents !== null);
    if (!text) return null;

    // 6. SEM tools no request
    const tools = body.tools;
    const functions = body.functions;
    if (Array.isArray(tools) && tools.length > 0) return null;
    if (Array.isArray(functions) && functions.length > 0) return null;
    // gemini: body.tools com functionDeclarations também cai aqui
    if (tools && typeof tools === "object" && !Array.isArray(tools)) {
      const toolObj = tools as Record<string, unknown>;
      if (Array.isArray(toolObj.functionDeclarations) && toolObj.functionDeclarations.length > 0) return null;
    }

    // 7. SEM atividade de tool no histórico
    if (hasToolActivity(msgList, contents !== null)) return null;

    // 8. Match determinístico
    const match = matchSynapseDeterministic(text, level || "lite");
    if (!match) return null;

    // 9. Log e resposta
    log?.line?.(reqTag, "⚙", `SYNAPSE:${level || "lite"}`);
    const synapseHeaders = { "X-ModelHub-Response-Source": "synapse" };
    const result = stream
      ? createStreamingResponse(sourceFormat, model, match, synapseHeaders)
      : createNonStreamingResponse(sourceFormat, model, match, synapseHeaders);
    return { success: true as const, response: result.response };
  } catch {
    // synapse: fail-open — qualquer erro → null
    return null;
  }
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
