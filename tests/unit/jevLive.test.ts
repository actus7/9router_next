import { describe, expect, it } from "vitest";

import { withTenant } from "@/lib/db/tenant";
import { evaluateJev, getJevApiKey } from "@/server/decisions/jev";
import { buildJevClassifierCallback } from "@/server/llm-gateway/application/routingClassifier";
import { updateSettings, getSettings } from "@/lib/db/repos/settingsRepo";

// Skipped by default: spends Vercel AI Gateway credit and needs the real
// database. Nothing is mocked — the key is the account's own
// `vercel-ai-gateway` connection, read and decrypted the way the gateway does.
//
//   NODE_OPTIONS="-r dotenv/config" DOTENV_CONFIG_PATH=.env \
//     LIVE_JEV=1 LIVE_JEV_USER=<uuid da conta> \
//     npx vitest run tests/unit/jevLive.test.ts
const live = process.env.LIVE_JEV === "1" && !!process.env.LIVE_JEV_USER;
const owner = String(process.env.LIVE_JEV_USER);

describe.skipIf(!live)("Jev against the real stack", () => {
  it("finds the account's Vercel AI Gateway key", async () => {
    expect(await withTenant(owner, () => getJevApiKey())).toBeTruthy();
  }, 30_000);

  it("answers choice, boolean and score questions", async () => {
    const answers = await withTenant(owner, () =>
      evaluateJev(
        "Prove that the square root of 2 is irrational.",
        {
          tier: { type: "choice", instructions: "How capable a model does this need?", criteria: { simple: "Trivial lookup or greeting", reasoning: "Formal proof or math" } },
          remember: { type: "boolean", instructions: "Does the user state a durable personal preference?" },
          difficulty: { type: "score", instructions: "How hard is it?", criteria: ["Easy", "Medium", "Hard"] },
        },
        15_000,
      ),
    );
    expect(answers?.tier).toMatchObject({ type: "choice", choice: "reasoning" });
    expect(answers?.remember.type).toBe("boolean");
    expect(answers?.difficulty.type).toBe("score");
  }, 30_000);

  it("classifies a smart-routing request when the feature is on", async () => {
    const result = await withTenant(owner, async () => {
      const before = await getSettings();
      await updateSettings({ decisionEngine: "jev", jevSmartRouting: true });
      try {
        return await buildJevClassifierCallback()("Write a Python function that parses ISO dates", "general", 15_000);
      } finally {
        await updateSettings({ decisionEngine: before.decisionEngine, jevSmartRouting: before.jevSmartRouting });
      }
    });
    expect(result).toMatchObject({ need: "coding", model: "typesafe-ai/jev" });
    expect(result!.confidence).toBeGreaterThan(0);
  }, 60_000);
});
