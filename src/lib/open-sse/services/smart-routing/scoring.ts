/**
 * Local routing scorer inspired by Manifest's former smart-routing scorer.
 * Manifest is MIT licensed: https://github.com/MadAppGang/manifest
 * This implementation is original and extends the approach for Portuguese,
 * endpoint capabilities, task classification, and RouterX request shapes.
 */

import type { RouteNeed, RoutingReason, RoutingTier } from "./types";

const TIER_SCORE: Record<RoutingTier, number> = {
  simple: -0.2,
  standard: 0,
  complex: 0.2,
  reasoning: 0.4,
};

const BOUNDARIES = { simpleMax: -0.1, standardMax: 0.08, complexMax: 0.35 };
const HISTORY_TTL_MS = 30 * 60 * 1_000;
const HISTORY_LIMIT = 5;

interface HistoryEntry {
  tiers: RoutingTier[];
  expiresAt: number;
}

const routingHistory = new Map<string, HistoryEntry>();

export interface RoutingSignals {
  text: string;
  lastUserText: string;
  tokenEstimate: number;
  conversationDepth: number;
  toolCount: number;
  hasImages: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface LocalRoutingAssessment {
  tier: RoutingTier;
  need: RouteNeed;
  score: number;
  confidence: number;
  needConfidence: number;
  reason: RoutingReason;
  signals: RoutingSignals;
}

const KEYWORDS = {
  formalLogic: [
    /\b(prove|proof|theorem|lemma|derive|deduce|contradiction|necessary and sufficient|formal logic)\b/i,
    /\b(prove|demonstre|demonstra[cç][aã]o|teorema|lema|deduza|contradi[cç][aã]o|necess[aá]ri[oa] e suficiente|l[oó]gica formal)\b/i,
  ],
  analytical: [
    /\b(analy[sz]e|evaluate|compare|trade-?offs?|root cause|architecture|strategy|optimi[sz]e|diagnose)\b/i,
    /\b(analis[ea]|avalie|compare|pr[oó]s e contras|causa raiz|arquitetura|estrat[eé]gia|otimiz[ea]|diagnostique)\b/i,
  ],
  coding: [
    /\b(code|implement|refactor|debug|compile|typescript|javascript|python|sql|api|regex|function|class|repository)\b/i,
    /\b(c[oó]digo|implemente|refatore|depure|compile|fun[cç][aã]o|classe|reposit[oó]rio|banco de dados)\b/i,
  ],
  simple: [
    /^(hi|hello|hey|thanks|thank you|ok|yes|no|translate|summari[sz]e|define|what is|who is)\b/i,
    /^(oi|ol[aá]|obrigad[oa]|valeu|ok|sim|n[aã]o|traduza|resuma|defina|o que [eé]|quem [eé])\b/i,
  ],
  multiStep: [
    /\b(first|then|after that|finally|step by step|multiple steps|plan and implement|end[- ]to[- ]end)\b/i,
    /\b(primeiro|depois|em seguida|por fim|passo a passo|v[aá]rias etapas|planeje e implemente|ponta a ponta)\b/i,
  ],
  creative: [
    /\b(brainstorm|creative|story|poem|campaign|tagline|script|novel)\b/i,
    /\b(ideias|criativ[oa]|hist[oó]ria|poema|campanha|slogan|roteiro|romance)\b/i,
  ],
  constraints: [
    /\b(must|must not|without|only|exactly|at least|at most|constraint|requirement)\b/gi,
    /\b(deve|n[aã]o deve|sem|somente|apenas|exatamente|pelo menos|no m[aá]ximo|restri[cç][aã]o|requisito)\b/gi,
  ],
};

const TASK_PATTERNS: Array<{ need: RouteNeed; patterns: RegExp[] }> = [
  { need: "image_generation", patterns: [/\b(generate|create|draw|edit).{0,24}\b(image|photo|illustration|logo)\b/i, /\b(gere|crie|desenhe|edite).{0,24}\b(imagem|foto|ilustra[cç][aã]o|logo)\b/i] },
  { need: "video_generation", patterns: [/\b(generate|create|animate|edit).{0,24}\b(video|animation|clip)\b/i, /\b(gere|crie|anime|edite).{0,24}\b(v[ií]deo|anima[cç][aã]o|clipe)\b/i] },
  { need: "web_search", patterns: [/\b(search the web|web search|look up online|latest news|current information)\b/i, /\b(pesquise (na )?web|busque online|[uú]ltimas not[ií]cias|informa[cç][aã]o atual)\b/i] },
  { need: "web_fetch", patterns: [/https?:\/\/\S+/i, /\b(fetch|open|read|summari[sz]e).{0,24}\b(url|page|website|link)\b/i, /\b(acesse|abra|leia|resuma).{0,24}\b(url|p[aá]gina|site|link)\b/i] },
  { need: "data_analysis", patterns: [/\b(data analysis|dataset|spreadsheet|statistics|chart|csv|xlsx|regression)\b/i, /\b(an[aá]lise de dados|planilha|estat[ií]stica|gr[aá]fico|regress[aã]o)\b/i] },
  { need: "coding", patterns: KEYWORDS.coding },
  { need: "email_management", patterns: [/\b(email|inbox|reply|newsletter)\b/i, /\b(e-?mail|caixa de entrada|responder|newsletter)\b/i] },
  { need: "calendar_management", patterns: [/\b(calendar|meeting|schedule|appointment)\b/i, /\b(calend[aá]rio|reuni[aã]o|agenda|compromisso)\b/i] },
  { need: "social_media", patterns: [/\b(social media|instagram|linkedin|tiktok|tweet|post)\b/i, /\b(rede social|publica[cç][aã]o|postagem)\b/i] },
  { need: "trading", patterns: [/\b(trading|stock|portfolio|forex|crypto|market order)\b/i, /\b(a[cç][aã]o|carteira|c[aâ]mbio|cripto|ordem de mercado)\b/i] },
  { need: "tts", patterns: [/\b(text to speech|synthesi[sz]e speech|voiceover|read aloud)\b/i, /\b(texto para fala|sintetize a fala|narra[cç][aã]o|leia em voz alta)\b/i] },
  { need: "stt", patterns: [/\b(speech to text|transcribe|audio transcription)\b/i, /\b(fala para texto|transcreva|transcri[cç][aã]o de [aá]udio)\b/i] },
  { need: "embeddings", patterns: [/\b(embedding|vectori[sz]e|semantic vector)\b/i, /\b(vetorize|vetor sem[aâ]ntico)\b/i] },
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((total, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return total + (text.match(new RegExp(pattern.source, flags))?.length || 0);
  }, 0);
}

function textFromContent(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textFromContent);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = [record.text, record.input_text, record.output_text, record.prompt, record.query]
    .filter((item): item is string => typeof item === "string");
  const nested = [record.content, record.parts, record.contents, record.input]
    .flatMap(textFromContent);
  return [...direct, ...nested];
}

function hasMediaMarker(value: unknown, kind: "image" | "audio" | "video"): boolean {
  const serialized = JSON.stringify(value || "").toLowerCase();
  return serialized.includes(`${kind}_url`) || serialized.includes(`input_${kind}`) || serialized.includes(`${kind}/`);
}

export function peelRoutingEnvelope(text: string): string {
  if (!text) return text;
  const header = text.match(/^\s*[^\n]{0,120}?(?:metadata|sender|envelope|context|system message)[^\n]{0,80}:\s*\n/i);
  if (!header) return text;
  const rest = text.slice(header[0].length).replace(/^\s+/, "");
  const fence = rest.match(/^```(?:json|jsonl|yaml|yml|toml|xml)?\n[\s\S]*?\n```/i);
  if (!fence) return text;
  const humanText = rest.slice(fence[0].length).trimStart();
  return humanText || text;
}

export function extractRoutingSignals(body: unknown): RoutingSignals {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const messages = Array.isArray(record.messages) ? record.messages as Array<Record<string, unknown>> : [];
  const geminiContents = Array.isArray(record.contents) ? record.contents as Array<Record<string, unknown>> : [];
  const responseInput = Array.isArray(record.input) ? record.input as Array<Record<string, unknown>> : [];
  const turns = messages.length ? messages : geminiContents.length ? geminiContents : responseInput;
  const allText = [record.prompt, record.query, record.input, record.text, record.instructions, turns]
    .flatMap(textFromContent)
    .filter(Boolean);
  const lastUser = [...turns].reverse().find((turn) => {
    const role = String(turn.role || turn.author || "user").toLowerCase();
    return role === "user" || role === "human";
  });
  const fallbackLast = allText.at(-1) || "";
  const lastUserText = peelRoutingEnvelope((lastUser ? textFromContent(lastUser).join("\n") : fallbackLast).trim());
  const text = allText.join("\n");
  const toolCount = Array.isArray(record.tools) ? record.tools.length : Array.isArray(record.functions) ? record.functions.length : 0;
  return {
    text,
    lastUserText,
    tokenEstimate: Math.ceil(text.length / 4),
    conversationDepth: turns.length,
    toolCount,
    hasImages: hasMediaMarker(body, "image"),
    hasAudio: hasMediaMarker(body, "audio"),
    hasVideo: hasMediaMarker(body, "video"),
  };
}

function classifyNeed(signals: RoutingSignals, endpointNeed: RouteNeed): { need: RouteNeed; confidence: number } {
  if (endpointNeed !== "general") return { need: endpointNeed, confidence: 1 };
  if (signals.hasImages) return { need: "vision", confidence: 1 };
  if (signals.toolCount > 0) return { need: "tool_use", confidence: 0.95 };

  let best: { need: RouteNeed; hits: number } = { need: "general", hits: 0 };
  for (const candidate of TASK_PATTERNS) {
    const hits = countMatches(signals.lastUserText, candidate.patterns);
    if (hits > best.hits) best = { need: candidate.need, hits };
  }
  if (best.hits === 0) return { need: "general", confidence: 0.55 };
  return { need: best.need, confidence: Math.min(0.98, 0.62 + best.hits * 0.12) };
}

function tierFromScore(score: number): RoutingTier {
  if (score <= BOUNDARIES.simpleMax) return "simple";
  if (score <= BOUNDARIES.standardMax) return "standard";
  if (score <= BOUNDARIES.complexMax) return "complex";
  return "reasoning";
}

function boundaryConfidence(score: number): number {
  const distance = Math.min(...Object.values(BOUNDARIES).map((boundary) => Math.abs(score - boundary)));
  return Math.max(0.05, Math.min(0.99, 1 - Math.exp(-distance * 9)));
}

function applyMomentum(score: number, messageLength: number, sessionKey?: string): { score: number; applied: boolean } {
  if (!sessionKey) return { score, applied: false };
  const entry = routingHistory.get(sessionKey);
  if (!entry || entry.expiresAt <= Date.now() || entry.tiers.length === 0) {
    if (entry) routingHistory.delete(sessionKey);
    return { score, applied: false };
  }
  const weight = messageLength > 100 ? 0 : messageLength >= 30
    ? 0.3 * (1 - (messageLength - 30) / 70)
    : 0.3 + 0.3 * (1 - messageLength / 30);
  if (weight <= 0) return { score, applied: false };
  const average = entry.tiers.reduce((sum, tier) => sum + TIER_SCORE[tier], 0) / entry.tiers.length;
  return { score: score * (1 - weight) + average * weight, applied: true };
}

export function recordRoutingTier(sessionKey: string | undefined, tier: RoutingTier): void {
  if (!sessionKey) return;
  const previous = routingHistory.get(sessionKey);
  const tiers = [tier, ...(previous?.expiresAt && previous.expiresAt > Date.now() ? previous.tiers : [])]
    .slice(0, HISTORY_LIMIT);
  routingHistory.set(sessionKey, { tiers, expiresAt: Date.now() + HISTORY_TTL_MS });
}

export function scoreRoutingRequest(body: unknown, endpointNeed: RouteNeed = "general", sessionKey?: string): LocalRoutingAssessment {
  const signals = extractRoutingSignals(body);
  const text = signals.lastUserText;
  const need = classifyNeed(signals, endpointNeed);

  if (text.length > 0 && text.length < 22 && countMatches(text, KEYWORDS.formalLogic) === 0 && signals.toolCount === 0) {
    return { tier: "simple", need: need.need, score: -0.25, confidence: 0.9, needConfidence: need.confidence, reason: "short_message", signals };
  }

  const formal = countMatches(text, KEYWORDS.formalLogic);
  if (formal > 0) {
    return { tier: "reasoning", need: need.need, score: 0.48, confidence: 0.94, needConfidence: need.confidence, reason: "formal_logic_override", signals };
  }

  let score = 0;
  score += Math.min(0.18, countMatches(text, KEYWORDS.analytical) * 0.06);
  score += Math.min(0.15, countMatches(text, KEYWORDS.coding) * 0.05);
  score += Math.min(0.16, countMatches(text, KEYWORDS.multiStep) * 0.07);
  score += Math.min(0.06, countMatches(text, KEYWORDS.creative) * 0.03);
  score -= Math.min(0.16, countMatches(text, KEYWORDS.simple) * 0.08);
  score += Math.min(0.12, countMatches(text, KEYWORDS.constraints) * 0.025);
  score += Math.min(0.12, signals.tokenEstimate / 30_000 * 0.12);
  score += Math.min(0.06, Math.max(0, signals.conversationDepth - 2) * 0.008);
  score += Math.min(0.12, signals.toolCount * 0.04);
  score += Math.min(0.08, (text.match(/\b(if|unless|when|otherwise|se|caso|quando|sen[aã]o)\b/gi)?.length || 0) * 0.02);
  score += Math.min(0.06, (text.match(/^\s*(?:[-*]|\d+[.)])\s+/gm)?.length || 0) * 0.006);
  score += Math.min(0.08, (text.match(/```[\s\S]*?```/g)?.join("").length || 0) / Math.max(text.length, 1) * 0.1);

  if (signals.tokenEstimate > 50_000) {
    return { tier: "complex", need: need.need, score: Math.max(score, 0.2), confidence: 0.92, needConfidence: need.confidence, reason: "large_context", signals };
  }
  if (signals.toolCount > 0 && score < 0) score = 0;

  const momentum = applyMomentum(score, text.length, sessionKey);
  const tier = tierFromScore(momentum.score);
  const reason: RoutingReason = signals.toolCount > 0 ? "tool_detected" : momentum.applied ? "momentum" : "scored";
  return {
    tier,
    need: need.need,
    score: Number(momentum.score.toFixed(4)),
    confidence: Number(boundaryConfidence(momentum.score).toFixed(4)),
    needConfidence: need.confidence,
    reason,
    signals,
  };
}

