import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Usage intent telemetry: recent rows are classified into the routing needs
 * (Jev `usageTaxonomy`), the counts per intent are stored as one snapshot and
 * nothing is written when Jev is silent. Fail-open everywhere.
 *
 * Storage note: the snapshot is a run-wide aggregate, which the per-request
 * `usageHistory.meta` column cannot hold — it lives in the per-tenant meta
 * store (kv, scope "meta") under `usageIntents`.
 */

const decideWithJev = vi.hoisted(() => vi.fn());
vi.mock("@/server/decisions/jev", () => ({ decideWithJev }));

const getRequestDetails = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/repos/requestDetailsRepo", () => ({ getRequestDetails }));

const setTenantMeta = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/helpers/tenantMeta", () => ({ setTenantMeta }));

const all = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ all, get: vi.fn(), run: vi.fn(), transaction: (fn: () => unknown) => fn() })),
}));

import {
  classifyUsageIntents,
  USAGE_INTENTS_META_KEY,
} from "@/server/application/use-cases/usage/classifyUsageIntents";

function choiceAnswer(choice: string, confidence: number) {
  return { type: "choice", choice, confidence, probabilities: {} };
}

/** One requestDetails row per text, each with the last user message. */
function detailRows(texts: string[]) {
  return {
    details: texts.map((text, index) => ({
      model: `m${index}`,
      request: {
        messages: [{ role: "user", content: text }],
        routing: { tier: "standard", need: "general" },
      },
    })),
  };
}

/** Answers each batch-local `i<index>` from a fixed list. */
function jevChoices(pick: (index: number) => { choice: string; confidence: number } | null) {
  return async (_feature: unknown, state: unknown, questions: Record<string, unknown>) => {
    const items = (state as { items: unknown[] }).items;
    const answers: Record<string, unknown> = {};
    for (let index = 0; index < items.length; index += 1) {
      const verdict = pick(index);
      if (verdict && questions[`i${index}`]) answers[`i${index}`] = choiceAnswer(verdict.choice, verdict.confidence);
    }
    return Object.keys(answers).length > 0 ? { answers, source: "jev" } : null;
  };
}

beforeEach(() => {
  decideWithJev.mockReset();
  getRequestDetails.mockReset();
  setTenantMeta.mockReset();
  all.mockReset();
  getRequestDetails.mockResolvedValue({ details: [] });
  all.mockResolvedValue([]);
});

describe("classifyUsageIntents", () => {
  it("aggregates the counts per intent and stores one snapshot", async () => {
    getRequestDetails.mockResolvedValue(detailRows(["fix this bug", "write a poem", "debug my parser"]));
    decideWithJev.mockImplementation(
      jevChoices((index) => ({ choice: index === 1 ? "general" : "coding", confidence: 0.8 })),
    );

    const result = await classifyUsageIntents();

    expect(result.classified).toBe(3);
    expect(result.usageIntents).toEqual({
      coding: 2,
      general: 1,
      classifiedAt: expect.any(String),
      classified: 3,
    });
    expect(decideWithJev).toHaveBeenCalledWith(
      "usageTaxonomy",
      expect.objectContaining({ items: expect.any(Array) }),
      expect.objectContaining({ i0: expect.objectContaining({ type: "choice" }) }),
      { timeoutMs: 10_000 },
    );
    expect(setTenantMeta).toHaveBeenCalledOnce();
    const [db, key, value] = setTenantMeta.mock.calls[0] as [unknown, string, string];
    expect(db).toBeTruthy();
    expect(key).toBe(USAGE_INTENTS_META_KEY);
    expect(JSON.parse(value)).toEqual({
      coding: 2,
      general: 1,
      classifiedAt: expect.any(String),
      classified: 3,
    });
  });

  it("keeps only confident, well-formed choices", async () => {
    getRequestDetails.mockResolvedValue(detailRows(["low conf", "unknown choice", "solid"]));
    decideWithJev.mockImplementation(
      jevChoices((index) =>
        [
          { choice: "coding", confidence: 0.5 },
          { choice: "turbo", confidence: 0.9 },
          { choice: "coding", confidence: 0.9 },
        ][index]!,
      ),
    );

    const result = await classifyUsageIntents();
    expect(result.classified).toBe(1);
    expect(result.usageIntents).toMatchObject({ coding: 1, classified: 1 });
  });

  it("caps the row limit at 500 and defaults to 200", async () => {
    decideWithJev.mockResolvedValue(null);
    await classifyUsageIntents({ limit: 5000 });
    expect(getRequestDetails).toHaveBeenCalledWith({ pageSize: 500 });

    getRequestDetails.mockClear();
    await classifyUsageIntents();
    expect(getRequestDetails).toHaveBeenCalledWith({ pageSize: 200 });
  });

  it("a silent Jev classifies nothing and writes nothing", async () => {
    getRequestDetails.mockResolvedValue(detailRows(["fix this bug"]));
    decideWithJev.mockResolvedValue(null);

    const result = await classifyUsageIntents();
    expect(result).toEqual({ classified: 0 });
    expect(setTenantMeta).not.toHaveBeenCalled();
  });

  it("asks in batches of 40 items per Jev call", async () => {
    getRequestDetails.mockResolvedValue(detailRows(Array.from({ length: 45 }, (_v, i) => `request ${i}`)));
    decideWithJev.mockImplementation(jevChoices(() => ({ choice: "general", confidence: 0.8 })));

    const result = await classifyUsageIntents();
    expect(decideWithJev).toHaveBeenCalledTimes(2);
    const firstState = decideWithJev.mock.calls[0]![1] as { items: unknown[] };
    expect(firstState.items).toHaveLength(40);
    expect(result.classified).toBe(45);
  });

  it("falls back to usageHistory's model+tier meta when no text was kept", async () => {
    getRequestDetails.mockResolvedValue({ details: [] });
    all.mockResolvedValue([
      { model: "oc/m1", meta: JSON.stringify({ routing: { tier: "complex" } }) },
      { model: "oc/m2", meta: null },
    ]);
    decideWithJev.mockImplementation(jevChoices(() => ({ choice: "coding", confidence: 0.8 })));

    const result = await classifyUsageIntents();
    expect(result.classified).toBe(2);
    const state = decideWithJev.mock.calls[0]![1] as { items: Array<Record<string, unknown>> };
    // No prompt text anywhere: the coarse state is all Jev gets.
    expect(state.items[0]).toEqual({ id: "i0", model: "oc/m1", tier: "complex" });
    expect(state.items[1]).toEqual({ id: "i1", model: "oc/m2" });
  });
});
