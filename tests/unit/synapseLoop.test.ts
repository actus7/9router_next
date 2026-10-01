import { beforeEach, describe, expect, it, vi } from "vitest";

// The Synapse Loop end to end over an in-memory store: observe → shadow →
// active → served → audited/rejected → deprecated. Jev is stubbed; the
// heuristic path runs for real.

type Cap = {
  id: string; key: string; personaHash: string; canonicalInput: string; answer: string;
  status: "shadow" | "active" | "deprecated"; shadowRuns: number; shadowAgreements: number;
  served: number; rejections: number; source: "heuristic" | "jev"; createdAt: string; updatedAt: string;
};

const store = vi.hoisted(() => ({
  obs: [] as Array<{ key: string; personaHash: string; input: string; answer: string; model: string | null; createdAt: string; id: string }>,
  caps: [] as Cap[],
  events: [] as Array<{ capabilityId: string; type: string }>,
}));

vi.mock("@/lib/db/repos/synapseLoopRepo", () => ({
  insertObservation: vi.fn(async (o: { key: string; personaHash: string; input: string; answer: string; model: string | null }) => {
    store.obs.push({ ...o, id: String(store.obs.length), createdAt: new Date().toISOString() });
  }),
  listObservations: vi.fn(async (key: string, ph: string) => store.obs.filter((o) => o.key === key && o.personaHash === ph).reverse()),
  pruneObservations: vi.fn(async () => undefined),
  getCapability: vi.fn(async (key: string, ph: string) => store.caps.find((c) => c.key === key && c.personaHash === ph) ?? null),
  listCapabilitiesByKey: vi.fn(async (key: string) => store.caps.filter((c) => c.key === key)),
  createShadowCapability: vi.fn(async (c: Pick<Cap, "key" | "personaHash" | "canonicalInput" | "answer" | "source">) => {
    if (store.caps.some((x) => x.key === c.key && x.personaHash === c.personaHash)) return;
    store.caps.push({ ...c, id: `cap${store.caps.length}`, status: "shadow", shadowRuns: 0, shadowAgreements: 0, served: 0, rejections: 0, createdAt: "", updatedAt: "" });
  }),
  bumpCapability: vi.fn(async (id: string, p: Partial<Cap>) => {
    const c = store.caps.find((x) => x.id === id)!;
    c.shadowRuns += p.shadowRuns ?? 0;
    c.shadowAgreements += p.shadowAgreements ?? 0;
    c.served += p.served ?? 0;
    c.rejections += p.rejections ?? 0;
    if (p.status) c.status = p.status;
  }),
  demoteToShadow: vi.fn(async (id: string) => {
    const c = store.caps.find((x) => x.id === id)!;
    c.status = "shadow"; c.shadowRuns = 0; c.shadowAgreements = 0; c.rejections += 1;
  }),
  insertSynapseEvent: vi.fn(async (capabilityId: string, type: string) => { store.events.push({ capabilityId, type }); }),
}));

const evaluateJev = vi.hoisted(() => vi.fn());
vi.mock("@/server/decisions/jev", () => ({ evaluateJev }));

import {
  LOOP_LIMITS, learningKey, personaHash, heuristicStable, deterministicUnstable, observeAnswer, lookupLearned, rejectLearned,
} from "@/server/synapse/loop";
import { buildMemoryPromptBlock } from "@/shared/harness/agentMemory";
import { buildSkillsPromptBlock } from "@/shared/harness/agentSkills";

const Q = "Qual é a capital da França?";
const A = "A capital da França é Paris.";
const heuristic = { useJev: false };

async function learnToActive(input = Q, answer = A) {
  await observeAnswer({ input, systemText: null, answer, model: "m" }, heuristic);
  await observeAnswer({ input, systemText: null, answer: "Paris é a capital da França.", model: "m" }, heuristic);
  for (let i = 0; i < LOOP_LIMITS.minShadowRuns; i++) {
    await observeAnswer({ input, systemText: null, answer, model: "m" }, heuristic);
  }
}

beforeEach(() => {
  store.obs.length = 0;
  store.caps.length = 0;
  store.events.length = 0;
  evaluateJev.mockReset();
});

describe("chave e persona", () => {
  it("normaliza a pergunta e recusa o que não é curto", () => {
    expect(learningKey("  Qual é a CAPITAL da França?? ")).toBe(learningKey("qual e a capital da franca"));
    expect(learningKey("x".repeat(200))).toBeNull();
    expect(learningKey("   ")).toBeNull();
  });

  it("memória e skills não mudam a persona; o system prompt do usuário muda", () => {
    const base = "Você é um assistente conciso.";
    const withMemory = [base, buildMemoryPromptBlock({ agent: [{ id: "1", content: "gosta de TS" }], user: [], agentChars: 10, userChars: 0, agentLimit: 100, userLimit: 100 } as never)].join("\n\n");
    const withSkills = [base, buildSkillsPromptBlock([{ id: "s", description: "faz x" }] as never)].join("\n\n");
    expect(personaHash(withMemory)).toBe(personaHash(base));
    expect(personaHash(withSkills)).toBe(personaHash(base));
    expect(personaHash("Você é um pirata.")).not.toBe(personaHash(base));
    expect(personaHash(null)).toBe(personaHash(""));
  });
});

describe("estabilidade (heurística)", () => {
  it("recusa respostas que dependem de tempo, conversa ou pessoa", () => {
    expect(heuristicStable(Q, A)).toBe(true);
    expect(heuristicStable("que horas são agora?", "São 14:32.")).toBe(false);
    expect(heuristicStable("qual o preço do bitcoin hoje?", "Cerca de US$ 60 mil.")).toBe(false);
    expect(heuristicStable("e o segundo?", "O segundo é B.")).toBe(false);
    expect(heuristicStable("qual é o meu nome?", "Seu nome é Ana.")).toBe(false);
    expect(heuristicStable("me explica", "Sobre o quê?")).toBe(false);
  });
});

describe("ciclo de vida", () => {
  it("uma observação não cria nada; duas equivalentes criam a competência em shadow", async () => {
    await observeAnswer({ input: Q, systemText: null, answer: A, model: "m" }, heuristic);
    expect(store.caps).toHaveLength(0);
    await observeAnswer({ input: Q, systemText: null, answer: "Paris é a capital da França.", model: "m" }, heuristic);
    expect(store.caps).toHaveLength(1);
    expect(store.caps[0].status).toBe("shadow");
  });

  it("respostas divergentes para a mesma pergunta não criam competência", async () => {
    await observeAnswer({ input: "me dá uma ideia de nome", systemText: null, answer: "Que tal Aurora?", model: "m" }, heuristic);
    await observeAnswer({ input: "me dá uma ideia de nome", systemText: null, answer: "Sugiro Nimbus, curto e marcante.", model: "m" }, heuristic);
    expect(store.caps).toHaveLength(0);
  });

  it("shadow só vira active com evidência suficiente", async () => {
    await learnToActive();
    expect(store.caps[0].status).toBe("active");
    expect(store.events.map((e) => e.type)).toContain("promoted");
  });

  it("shadow com respostas que não batem não promove", async () => {
    await observeAnswer({ input: Q, systemText: null, answer: A, model: "m" }, heuristic);
    await observeAnswer({ input: Q, systemText: null, answer: A, model: "m" }, heuristic);
    for (let i = 0; i < LOOP_LIMITS.minShadowRuns; i++) {
      await observeAnswer({ input: Q, systemText: null, answer: i % 2 ? A : "Não sei dizer, depende do contexto histórico.", model: "m" }, heuristic);
    }
    expect(store.caps[0].status).toBe("shadow");
  });

  it("active é servida localmente, e uma em cada N vai ao LLM para auditoria", async () => {
    await learnToActive();
    const served: Array<string | null> = [];
    for (let i = 0; i < LOOP_LIMITS.auditEvery; i++) served.push((await lookupLearned({ input: Q, systemText: null }))?.answer ?? null);
    expect(served.filter(Boolean).length).toBe(LOOP_LIMITS.auditEvery - 1);
    expect(served.filter((s) => s === null)).toHaveLength(1);
  });

  it("persona diferente não recebe a resposta aprendida", async () => {
    await learnToActive();
    expect(await lookupLearned({ input: Q, systemText: "Você é um pirata." })).toBeNull();
  });

  it("auditoria que diverge tira de uso; divergir de novo depois de se reprovar aposenta", async () => {
    const diverge = () => observeAnswer({ input: Q, systemText: null, answer: "A capital mudou recentemente para Lyon.", model: "m" }, heuristic);
    await learnToActive();
    await diverge();
    expect(store.caps[0].status).toBe("shadow");
    expect(await lookupLearned({ input: Q, systemText: null })).toBeNull();
    for (let i = 0; i < LOOP_LIMITS.minShadowRuns; i++) await observeAnswer({ input: Q, systemText: null, answer: A, model: "m" }, heuristic);
    expect(store.caps[0].status).toBe("active");
    await diverge();
    expect(store.caps[0].status).toBe("deprecated");
  });

  it("uma rejeição tira a competência de uso na hora (Regenerar não recebe a mesma resposta)", async () => {
    await learnToActive();
    await rejectLearned(Q);
    expect(store.caps[0].status).toBe("shadow");
    expect(store.caps[0].shadowRuns).toBe(0);
    expect(await lookupLearned({ input: Q, systemText: null })).toBeNull();
  });

  it("👎/Regenerar no chat rejeita pela pergunta", async () => {
    await learnToActive();
    for (let i = 0; i < LOOP_LIMITS.maxRejections; i++) await rejectLearned(Q);
    expect(store.caps[0].status).toBe("deprecated");
  });

  it("depreciada não é reaprendida sozinha", async () => {
    await learnToActive();
    for (let i = 0; i < LOOP_LIMITS.maxRejections; i++) await rejectLearned(Q);
    await learnToActive();
    expect(store.caps).toHaveLength(1);
    expect(store.caps[0].status).toBe("deprecated");
  });
});

describe("modo Jev", () => {
  it("Jev decide equivalência (paráfrase longa passa) e estabilidade", async () => {
    evaluateJev.mockImplementation(async (_state: unknown, questions: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const id of Object.keys(questions)) out[id] = { type: "boolean", probability: 0.97 };
      return out;
    });
    const jev = { useJev: true };
    await observeAnswer({ input: Q, systemText: null, answer: "Paris. É a capital e maior cidade do país, às margens do Sena.", model: "m" }, jev);
    await observeAnswer({ input: Q, systemText: null, answer: "A capital francesa é Paris, cortada pelo rio Sena.", model: "m" }, jev);
    expect(store.caps).toHaveLength(1);
    expect(store.caps[0].source).toBe("jev");
  });

  it("Jev indisponível cai na heurística", async () => {
    evaluateJev.mockResolvedValue(null);
    const jev = { useJev: true };
    await observeAnswer({ input: Q, systemText: null, answer: A, model: "m" }, jev);
    await observeAnswer({ input: Q, systemText: null, answer: "Paris é a capital da França.", model: "m" }, jev);
    expect(store.caps).toHaveLength(1);
    expect(store.caps[0].source).toBe("heuristic");
  });

  it("Jev decide; a heurística só decide quando Jev é null", async () => {
    const jev = { useJev: true };
    // The heuristic alone rejects this (TIME_BOUND on "hoje"). Jev-first means
    // Jev's verdict stands on its own: it approves, the turn is learned.
    evaluateJev.mockImplementation(async (_state: unknown, questions: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const id of Object.keys(questions)) out[id] = { type: "boolean", probability: 0.99 };
      return out;
    });
    await observeAnswer({ input: "qual o preço do bitcoin hoje?", systemText: null, answer: "Um bitcoin.", model: "m" }, jev);
    await observeAnswer({ input: "qual o preço do bitcoin hoje?", systemText: null, answer: "Bitcoin é um ativo digital.", model: "m" }, jev);
    expect(store.caps).toHaveLength(1);
    expect(store.caps[0].source).toBe("jev");

    // Jev null hands the decision back to the heuristic, which says no.
    store.caps.length = 0;
    evaluateJev.mockResolvedValue(null);
    await observeAnswer({ input: "qual o preço do petróleo hoje?", systemText: null, answer: "Um barril.", model: "m" }, jev);
    await observeAnswer({ input: "qual o preço do petróleo hoje?", systemText: null, answer: "Barril de petróleo.", model: "m" }, jev);
    expect(store.caps).toHaveLength(0);
  });

  it("relógio/ano/pergunta de volta vetam mesmo com Jev aprovando", async () => {
    const jev = { useJev: true };
    evaluateJev.mockImplementation(async (_state: unknown, questions: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const id of Object.keys(questions)) out[id] = { type: "boolean", probability: 0.99 };
      return out;
    });
    for (const answer of ["São 14:32.", "Em 2030.", "Sobre o quê?"]) {
      expect(deterministicUnstable(answer)).toBe(true);
      await observeAnswer({ input: Q, systemText: null, answer, model: "m" }, jev);
      await observeAnswer({ input: Q, systemText: null, answer, model: "m" }, jev);
    }
    expect(deterministicUnstable(A)).toBe(false);
    expect(store.caps).toHaveLength(0);
  });

  it("sem useJev a heurística decide como antes, sem consultar Jev", async () => {
    await learnToActive();
    expect(store.caps[0].status).toBe("active");
    expect(evaluateJev).not.toHaveBeenCalled();
  });
});
