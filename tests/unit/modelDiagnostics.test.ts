import { describe, expect, it } from "vitest";

import {
  diagnosticBadge,
  diagnosticStyle,
  sortForDisplay,
} from "@/app/(dashboard)/dashboard/providers/[id]/sections/models/diagnosticStates";
import { deletableModelIds } from "@/app/(dashboard)/dashboard/providers/[id]/hooks/useDiagnosticActions";
import { eligibleTestIds } from "@/app/(dashboard)/dashboard/providers/[id]/hooks/modelTestHelpers";
import type { CustomModelEntry, ModelDiagnostic } from "@/app/(dashboard)/dashboard/providers/[id]/types";

function diagnostic(partial: Partial<ModelDiagnostic> & { modelId: string }): ModelDiagnostic {
  return { ok: false, attempts: 1, ...partial };
}

/**
 * The diagnostics modal used to render four near-identical blocks, one per
 * state. They are one row driven by a table now, which is only an improvement
 * while the table actually covers every state and keeps failures at the top —
 * failures are the rows with buttons on them.
 */
describe("diagnostic display order", () => {
  it("puts failures above everything settled, and running rows above those", () => {
    const ordered = sortForDisplay([
      diagnostic({ modelId: "passed-one", state: "passed", ok: true }),
      diagnostic({ modelId: "failed-one", state: "failed" }),
      diagnostic({ modelId: "cancelled-one", state: "cancelled" }),
      diagnostic({ modelId: "running-one", state: "testing" }),
    ]).map((r) => r.modelId);

    expect(ordered).toEqual(["running-one", "failed-one", "cancelled-one", "passed-one"]);
  });

  it("keeps rows of the same state in the order the run produced them", () => {
    const ordered = sortForDisplay([
      diagnostic({ modelId: "b", state: "failed" }),
      diagnostic({ modelId: "a", state: "failed" }),
    ]).map((r) => r.modelId);

    expect(ordered).toEqual(["b", "a"]);
  });

  it("has a style for every state a diagnostic can carry", () => {
    for (const state of ["queued", "testing", "retrying", "passed", "failed", "cancelled"] as const) {
      expect(diagnosticStyle(diagnostic({ modelId: "m", state })), state).toBeDefined();
    }
    // A result written before `state` existed still has to render.
    expect(diagnosticStyle(diagnostic({ modelId: "m" }))).toBeDefined();
  });
});

describe("diagnostic badge", () => {
  it("shows latency on a pass and attempt count on a repeated failure", () => {
    expect(diagnosticBadge(diagnostic({ modelId: "m", state: "passed", ok: true, latencyMs: 2941 }))).toBe("2941ms");
    expect(diagnosticBadge(diagnostic({ modelId: "m", state: "failed", attempts: 3 }))).toContain("3x");
  });

  it("says nothing about a failure that only ran once", () => {
    expect(diagnosticBadge(diagnostic({ modelId: "m", state: "failed", attempts: 1 }))).toBeNull();
  });
});

/**
 * Only a model the user typed in can be deleted for good. A discovered one
 * returns on the next refresh, so offering Delete for it would be a button
 * that undoes itself — which is exactly the trap this rule exists to avoid.
 */
describe("deletableModelIds", () => {
  const entries: CustomModelEntry[] = [
    { id: "typed-in", source: "manual", providerAlias: "openai" },
    { id: "found-by-discovery", source: "discovered", providerAlias: "openai" },
    { id: "another-provider", source: "manual", providerAlias: "anthropic" },
    { id: "legacy-no-alias", source: "manual" },
  ];

  it("offers deletion only for manually added models of this provider", () => {
    expect(deletableModelIds(entries, "openai")).toEqual(["typed-in", "legacy-no-alias"]);
  });

  it("never offers it for a discovered model", () => {
    expect(deletableModelIds(entries, "openai")).not.toContain("found-by-discovery");
  });
});

/**
 * A run tests every enabled model, so this list is the run: a model missing
 * here is a model nobody tests, and a duplicate is a model tested twice.
 */
describe("eligibleTestIds", () => {
  const models = [{ id: "llm-a" }, { id: "whisper-1" }, { id: "flux-schnell" }, { id: "llm-b" }, { id: "  " }];
  const freeModels = [{ id: "llm-a" }, { id: "llm-c" }];

  it("keeps LLMs only, deduped, minus the disabled ones", () => {
    expect(eligibleTestIds(models, freeModels, ["llm-b"])).toEqual(["llm-a", "llm-c"]);
  });

  it("covers a whole catalogue, however large", () => {
    const ids = Array.from({ length: 381 }, (_, i) => ({ id: `m-${i}` }));
    expect(eligibleTestIds(ids, [], [])).toHaveLength(381);
  });
});

/**
 * The run disables models the provider says do not exist. That is a change to
 * the account's configuration, so the row has to name it ahead of anything else.
 */
describe("auto-disabled rows", () => {
  it("says so instead of reporting the attempt count", () => {
    const badge = diagnosticBadge(diagnostic({ modelId: "gone", state: "failed", attempts: 3, autoDisabled: true }));
    expect(badge).toBe("Disabled automatically");
  });
});
