import { describe, expect, it } from "vitest";
import { isParamApplicable, type Applicability } from "@/app/(dashboard)/dashboard/combos/[id]/paramApplicability";

describe("isParamApplicable", () => {
  it("is always available without a rule", () => expect(isParamApplicable(undefined, {})).toBe(true));
  it("except: unavailable when the other value matches", () => {
    expect(isParamApplicable({ except: { do_sample: false } }, { do_sample: false })).toBe(false);
    expect(isParamApplicable({ except: { do_sample: false } }, { do_sample: true })).toBe(true);
  });
  it("only: needs the other value, and a missing one does not match", () => {
    const rule = { only: { "thinking.type": "enabled" } };
    expect(isParamApplicable(rule, { "thinking.type": "enabled" })).toBe(true);
    expect(isParamApplicable(rule, {})).toBe(false);
  });
  it("arrays are OR, {not} needs a present different value", () => {
    const rule: Applicability = { except: [{ "thinking.type": ["adaptive", "enabled"] }, { temperature: { not: 1 } }] };
    expect(isParamApplicable(rule, { temperature: 0.5 })).toBe(false);
    expect(isParamApplicable(rule, { temperature: 1, "thinking.type": "disabled" })).toBe(true);
    expect(isParamApplicable(rule, {})).toBe(true);
  });
});
