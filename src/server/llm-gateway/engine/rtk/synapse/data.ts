// synapse: Padrões determinísticos pt-BR para o gateway LLM.
// Adaptação do synapse (https://github.com/actus7/synapse, Apache-2.0).
// Motor determinístico — só responde padrões inequívocos; falso positivo é
// pior que gastar tokens. Todas as patterns são regex ANCORADAS de sentença
// inteira (^...$ com pontuação opcional tolerada) — nunca substring solta.
//
// synapse: o engine verifica se a keyword key aparece na sentença (via \b)
// ANTES de aplicar as rules. Cada variante precisa de sua própria keyword.
// goto só funciona quando o destino é substring da sentença original.

export type SynapseRule = {
  pattern: string | RegExp;
  responses: string[];
  memFlag?: boolean;
  goto?: string;
};

export type SynapseKeyword = {
  key: string;
  priority: number;
  level: "lite" | "full";
  rules: SynapseRule[];
};

export type SynapseDeterministicData = {
  preTransforms: { from: string; to: string }[];
  postTransforms: { from: string; to: string }[];
  keywords: SynapseKeyword[];
};

// synapse: responses compartilhadas para reduzir duplicação
const GREETING_RESPONSES = [
  "Olá! Como posso ajudar?",
  "Oi! Em que posso ser útil hoje?",
  "Olá! Em que posso ajudá-lo?",
  "Oi! Precisa de alguma ajuda?",
];

const FAREWELL_RESPONSES = [
  "Até mais! Tenha um ótimo dia.",
  "Tchau! Precisando, é só chamar.",
  "Até logo! Volte quando quiser.",
];

const THANKS_RESPONSES = [
  "De nada! Precisando, é só chamar.",
  "Disponha! Qualquer dúvida, é só perguntar.",
  "Por nada! Estou à disposição.",
];

const HOW_ARE_YOU_RESPONSES = [
  "Tudo bem por aqui! E você, como posso ajudar?",
  "Tudo ótimo! Em que posso ser útil?",
  "Tudo certo! Precisa de alguma ajuda?",
];

const IDENTITY_RESPONSES = [
  "Sou um assistente de IA respondendo por este gateway. Como posso ajudar?",
  "Sou um assistente de IA. Em que posso ajudá-lo?",
];

const ACK_RESPONSES = [
  "Perfeito! Precisa de mais alguma coisa?",
  "Ótimo! Estou à disposição.",
  "Certo! Qualquer dúvida, é só chamar.",
];

export const synapseDeterministicData: SynapseDeterministicData = {
  // ── preTransforms: normalização de gírias pt-BR ──────────────────────────
  preTransforms: [
    { from: "vc", to: "voce" },
    { from: "vcs", to: "voces" },
    { from: "tb", to: "tambem" },
    { from: "tbm", to: "tambem" },
    { from: "pq", to: "porque" },
    { from: "ñ", to: "nao" },
    { from: "blz", to: "beleza" },
    { from: "vlw", to: "valeu" },
    { from: "obg", to: "obrigado" },
    { from: "msg", to: "mensagem" },
    { from: "hj", to: "hoje" },
    { from: "agr", to: "agora" },
    { from: "flw", to: "falou" },
    { from: "eae", to: "e ai" },
  ],

  // ── postTransforms: reflexão de pronomes (mecanismo portado; sem uso ativo
  //    pelas nossas responses, mas mantido para compatibilidade com engine) ──
  postTransforms: [
    { from: "eu", to: "voce" },
    { from: "meu", to: "seu" },
    { from: "minha", to: "sua" },
    { from: "mim", to: "voce" },
    { from: "estou", to: "esta" },
    { from: "sou", to: "e" },
  ],

  // ── keywords ─────────────────────────────────────────────────────────────
  keywords: [
    // ═══════════════════════════════════════════════════════════════════════
    // LITE — Prioridade 10: Saudações
    // ═══════════════════════════════════════════════════════════════════════
    {
      key: "ola",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^ola[!.?]*$/i, responses: GREETING_RESPONSES }],
    },
    {
      key: "oi",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^oi[!.?]*$/i, responses: GREETING_RESPONSES }],
    },
    {
      key: "opa",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^opa[!.?]*$/i, responses: GREETING_RESPONSES }],
    },
    {
      key: "e ai",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^e ai[!.?]*$/i, responses: GREETING_RESPONSES }],
    },
    {
      key: "hello",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^hello[!.?]*$/i, responses: GREETING_RESPONSES }],
    },
    {
      key: "hi",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^hi[!.?]*$/i, responses: GREETING_RESPONSES }],
    },
    {
      key: "hey",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^hey[!.?]*$/i, responses: GREETING_RESPONSES }],
    },
    {
      key: "bom dia",
      priority: 10,
      level: "lite",
      rules: [
        {
          pattern: /^bom dia[!.?]*$/i,
          responses: ["Bom dia! Como posso ajudar?", "Bom dia! Em que posso ser útil?"],
        },
      ],
    },
    {
      key: "boa tarde",
      priority: 10,
      level: "lite",
      rules: [
        {
          pattern: /^boa tarde[!.?]*$/i,
          responses: ["Boa tarde! Como posso ajudar?", "Boa tarde! Em que posso ser útil?"],
        },
      ],
    },
    {
      key: "boa noite",
      priority: 10,
      level: "lite",
      rules: [
        {
          pattern: /^boa noite[!.?]*$/i,
          responses: ["Boa noite! Como posso ajudar?", "Boa noite! Em que posso ser útil?"],
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LITE — Prioridade 10: Despedidas
    // ═══════════════════════════════════════════════════════════════════════
    {
      key: "tchau",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^tchau[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },
    {
      key: "ate logo",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^ate logo[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },
    {
      key: "ate mais",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^ate mais[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },
    {
      key: "ate amanha",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^ate amanha[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },
    {
      key: "adeus",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^adeus[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },
    {
      key: "bye",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^bye[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },
    {
      key: "goodbye",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^goodbye[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },
    {
      key: "falou",
      priority: 10,
      level: "lite",
      rules: [{ pattern: /^falou[!.?]*$/i, responses: FAREWELL_RESPONSES }],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LITE — Prioridade 9: Agradecimentos
    // ═══════════════════════════════════════════════════════════════════════
    {
      key: "obrigado",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^obrigado[!.?]*$/i, responses: THANKS_RESPONSES }],
    },
    {
      key: "obrigada",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^obrigada[!.?]*$/i, responses: THANKS_RESPONSES }],
    },
    {
      key: "valeu",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^valeu[!.?]*$/i, responses: THANKS_RESPONSES }],
    },
    {
      key: "thanks",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^thanks[!.?]*$/i, responses: THANKS_RESPONSES }],
    },
    {
      key: "thank you",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^thank you[!.?]*$/i, responses: THANKS_RESPONSES }],
    },
    {
      key: "thx",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^thx[!.?]*$/i, responses: THANKS_RESPONSES }],
    },
    {
      key: "agradecido",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^agradecido[!.?]*$/i, responses: THANKS_RESPONSES }],
    },
    {
      key: "agradecida",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^agradecida[!.?]*$/i, responses: THANKS_RESPONSES }],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LITE — Prioridade 9: Como-vai
    // ═══════════════════════════════════════════════════════════════════════
    {
      key: "tudo bem",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^tudo bem\??[!.?]*$/i, responses: HOW_ARE_YOU_RESPONSES }],
    },
    {
      key: "tudo bom",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^tudo bom\??[!.?]*$/i, responses: HOW_ARE_YOU_RESPONSES }],
    },
    {
      key: "como vai",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^como vai\??[!.?]*$/i, responses: HOW_ARE_YOU_RESPONSES }],
    },
    {
      key: "como voce esta",
      priority: 9,
      level: "lite",
      rules: [{ pattern: /^como voce esta\??[!.?]*$/i, responses: HOW_ARE_YOU_RESPONSES }],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FULL — Prioridade 8: Identidade
    // ═══════════════════════════════════════════════════════════════════════
    {
      key: "quem e voce",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^quem e voce[!.?]*$/i, responses: IDENTITY_RESPONSES }],
    },
    {
      key: "o que voce e",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^o que voce e[!.?]*$/i, responses: IDENTITY_RESPONSES }],
    },
    {
      key: "qual e o seu nome",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^qual e o seu nome[!.?]*$/i, responses: IDENTITY_RESPONSES }],
    },
    {
      key: "o que voce faz",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^o que voce faz[!.?]*$/i, responses: IDENTITY_RESPONSES }],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FULL — Prioridade 8: Ping
    // ═══════════════════════════════════════════════════════════════════════
    {
      key: "ping",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^ping[!.?]*$/i, responses: ["pong"] }],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FULL — Prioridade 8: Confirmações curtas
    // synapse: NUNCA "sim"/"nao" soltos — risco de substring
    // ═══════════════════════════════════════════════════════════════════════
    {
      key: "ok",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^ok[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "okay",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^okay[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "certo",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^certo[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "perfeito",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^perfeito[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "beleza",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^beleza[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "entendi",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^entendi[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "compreendi",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^compreendi[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "muito bom",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^muito bom[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "otimo",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^otimo[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "show",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^show[!.?]*$/i, responses: ACK_RESPONSES }],
    },
    {
      key: "mandou bem",
      priority: 8,
      level: "full",
      rules: [{ pattern: /^mandou bem[!.?]*$/i, responses: ACK_RESPONSES }],
    },
  ],
};
