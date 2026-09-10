import { afterEach, describe, expect, it, vi } from "vitest";

import { trySkillWriteToolCall } from "@/app/(dashboard)/dashboard/basic-chat/hooks/executeSkillWriteToolCall";
import type { RuntimeToolContext } from "@/app/(dashboard)/dashboard/basic-chat/hooks/runtimeToolProviders";
import type { NormalizedModel } from "@/app/(dashboard)/dashboard/basic-chat/types";

/**
 * The skill-write tools read the route's answer twice: once for `error`, once
 * for `pending`. Reading a `Response` body twice throws, and the throw escapes
 * as a tool failure — so the agent was told the write failed on writes that
 * actually landed. These cover the two outcomes the route can report.
 */

const model = {
  id: "provider:model",
  requestModel: "model",
  name: "Model",
  providerId: "provider",
  providerName: "Provider",
  source: "configured",
} as NormalizedModel;

function context(events: Array<{ type: string; data: Record<string, unknown> }>): RuntimeToolContext {
  return {
    apiKey: "",
    model,
    signal: new AbortController().signal,
    onSkillEvent: (type, data) => events.push({ type, data }),
  };
}

/** PUT answers `put`; the catalogue refetch that follows answers an empty list. */
function stubFetch(put: unknown, extra?: unknown) {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (extra !== undefined && call === 1) return new Response(JSON.stringify(extra), { status: 200 });
    const isPut = extra === undefined ? call === 1 : call === 2;
    return new Response(JSON.stringify(isPut ? put : { skills: [] }), { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("skill write tool outcome", () => {
  it("reports a queued create back to the agent instead of throwing", async () => {
    vi.stubGlobal("fetch", stubFetch({ ok: true, pending: true, pendingId: "pw_1" }));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];

    const result = await trySkillWriteToolCall(
      { id: "call_1", name: "create_skill", arguments: "{}" },
      context(events),
      { name: "deploy", description: "how to deploy", body: "run the script" },
      new AbortController().signal,
    );

    expect(JSON.parse(String(result))).toMatchObject({ ok: true, pending: true, pendingId: "pw_1" });
    expect(events.map((event) => event.type)).toEqual(["skill/queued"]);
  });

  it("reports an applied update back to the agent instead of throwing", async () => {
    // First fetch is the GET of the existing skill, then the PUT, then the catalogue.
    vi.stubGlobal(
      "fetch",
      stubFetch({ ok: true }, { skill: { id: "deploy", description: "d", body: "b", enabled: true } }),
    );
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];

    const result = await trySkillWriteToolCall(
      { id: "call_2", name: "update_skill", arguments: "{}" },
      context(events),
      { name: "deploy", body: "new body" },
      new AbortController().signal,
    );

    expect(JSON.parse(String(result))).toMatchObject({ ok: true, name: "deploy" });
    expect(events.map((event) => event.type)).toEqual(["skill/updated"]);
  });
});
