import { describe, expect, it } from "vitest";

import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { holdFreeFallback, isFreeFallbackHeld } from "@/server/llm-gateway/engine/utils/firstByteGuard";

/**
 * x-no-free-fallback holds the free default for the whole request. The combo
 * released it on its last attempt (and after every attempt), so a model test
 * run against a combo "passed" through the anonymous free model.
 */
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe("a combo whose caller refused the free fallback", () => {
  it("keeps the free default held on every attempt, the last one included", async () => {
    const body: Record<string, unknown> = { model: "combo", messages: [{ role: "user", content: "hi" }] };
    holdFreeFallback(body, true);
    const held: boolean[] = [];

    await handleComboChat({
      body,
      models: ["a/one", "b/two"],
      handleSingleModel: async (b: Record<string, unknown>) => {
        held.push(isFreeFallbackHeld(b));
        return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
      },
      log,
      hedge: false,
    } as unknown as Parameters<typeof handleComboChat>[0]);

    expect(held).toEqual([true, true]);
  });

  it("still releases the last attempt when the caller did not hold it", async () => {
    const body: Record<string, unknown> = { model: "combo", messages: [{ role: "user", content: "hi" }] };
    const held: boolean[] = [];

    await handleComboChat({
      body,
      models: ["a/one", "b/two"],
      handleSingleModel: async (b: Record<string, unknown>) => {
        held.push(isFreeFallbackHeld(b));
        return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
      },
      log,
      hedge: false,
    } as unknown as Parameters<typeof handleComboChat>[0]);

    expect(held).toEqual([true, false]);
  });
});
