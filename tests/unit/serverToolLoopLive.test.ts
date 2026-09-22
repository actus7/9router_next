import { describe, expect, it } from "vitest";

import { withTenant } from "@/lib/db/tenant";
import { deleteHarnessRuns, getHarnessRun } from "@/lib/db/repos/harnessRunsRepo";
import { listHarnessEvents } from "@/lib/db/repos/harnessConversationsRepo";
import { startDurableRun } from "@/server/application/use-cases/harness/durableRun";
import { getApiKeys } from "@/lib/db/repos/apiKeysRepo";

/**
 * The server-side tool loop against the real stack, with nothing stubbed.
 *
 * `docs/CONVENTIONS.md` records why this file has to exist: the durable-run
 * work reached a user broken twice because every test mocked at least one edge,
 * so each piece was proven against a stub and the seams between them were not
 * proven at all. Moving the tool loop into the worker added a whole new set of
 * those seams — the run's own deadline, the in-process dispatch that replaces
 * HTTP, the domain calls that replace routes whose `requireDashboardAccess()` a
 * worker can never satisfy.
 *
 * This drives the real `startDurableRun` against the real database and the
 * account's real provider, with a tool the model can actually call. Nothing is
 * mocked: if the loop cannot feed a tool result back into a continuation, this
 * fails.
 *
 * Off by default — it spends provider quota and needs `DATABASE_URL`.
 *
 *   NODE_OPTIONS="-r dotenv/config" DOTENV_CONFIG_PATH=.env \
 *     LIVE_TOOL_RUN=1 \
 *     LIVE_RUN_USER=<uuid da conta> \
 *     LIVE_RUN_MODEL=<provider/model> \
 *     npx vitest run tests/unit/serverToolLoopLive.test.ts
 *
 * `search_past_sessions` is the tool it asks for, deliberately: it is answered
 * entirely from this account's own database, so the assertion is about the loop
 * rather than about whichever provider happens to be connected. A media tool
 * needs an image/audio/video provider on the account; when there is one, point
 * `LIVE_TOOL` at `generate_image` and give it a prompt instead. With an image
 * provider connected, `LIVE_EXPECT_IMAGE=1` makes the media case require an
 * actual image rather than accept the explained failure.
 */
const live = process.env.LIVE_TOOL_RUN === "1" && !!process.env.LIVE_RUN_USER;

/**
 * The account's own key, when one was not supplied.
 *
 * `requireApiKey` gates the gateway, and the worker only forwards a key it can
 * prove the caller owns — so the key has to belong to this same account.
 * Reading it here rather than asking for it on a command line keeps the secret
 * out of shell history and out of this test's output.
 */
async function ownKey(owner: string): Promise<string | null> {
  if (process.env.LIVE_RUN_KEY) return String(process.env.LIVE_RUN_KEY);
  const keys = await withTenant(owner, () => getApiKeys());
  return keys.find((key) => key.isActive !== false)?.key ?? null;
}

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search_past_sessions",
    description: "Search the user's previous conversations for a phrase.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

const IMAGE_TOOL = {
  type: "function",
  function: {
    name: "generate_image",
    description: "Generate an image from a prompt.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    },
  },
};

describe.skipIf(!live)("server-side tool loop against the real stack", () => {
  it("runs a tool and continues the turn with no browser involved", async () => {
    const owner = String(process.env.LIVE_RUN_USER);
    const model = process.env.LIVE_RUN_MODEL || "zai-web/glm-5-turbo";
    const authorization = await ownKey(owner).then((key) => (key ? `Bearer ${key}` : null));
    expect(authorization, "no active API key for this account — the gateway gate would refuse the run").toBeTruthy();
    const sessionId = `live-tool-${Date.now()}`;
    const messageId = `live-msg-${Date.now()}`;

    const { runId } = await withTenant(owner, () =>
      startDurableRun({
        sessionId,
        messageId,
        body: {
          model,
          messages: [
            {
              role: "user",
              content:
                "Call the search_past_sessions tool with the query \"deploy\", then tell me in one short sentence whether it found anything.",
            },
          ],
          tools: [SEARCH_TOOL],
          tool_choice: "auto",
        },
        authorization,
      }),
    );

    expect(runId).toBeTruthy();

    // Nobody is watching the stream. The only thing that settles this row is
    // the worker finishing the loop on its own.
    const deadline = Date.now() + 180_000;
    let run = await withTenant(owner, () => getHarnessRun(runId));
    while (run?.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      run = await withTenant(owner, () => getHarnessRun(runId));
    }

    try {
      expect(run, "the run row vanished").toBeTruthy();
      expect(run?.status, `run ended as ${run?.status}: ${run?.error ?? ""}`).toBe("completed");
      expect(String(run?.partialText ?? "").trim().length).toBeGreaterThan(0);

      // The proof that the loop ran here and not in a browser: the worker
      // writes these itself, and no browser was ever connected.
      const events = await withTenant(owner, () => listHarnessEvents(sessionId));
      const toolEvents = events.filter((event) => event.type === "tool/call" || event.type === "tool/result");
      expect(toolEvents.length, "no tool events — the model never called the tool").toBeGreaterThan(0);
      expect(toolEvents.every((event) => event.data.ranOn === "server")).toBe(true);
    } finally {
      await withTenant(owner, () => deleteHarnessRuns([runId])).catch(() => undefined);
    }
  }, 240_000);

  /**
   * Media generation reaching the worker, proven by where the answer comes
   * from rather than by an image.
   *
   * This account has no image provider connected, so the call cannot succeed —
   * and that is exactly what makes the assertion sharp: a `generate_image`
   * result that says "no configured image generation provider" can only have
   * been produced by `serverMediaTools` reading the real catalogue against the
   * real database. If the worker had handed the call back instead, there would
   * be no tool event and no result at all, because nothing was watching.
   *
   * Connect an image provider and this becomes a full verification: the same
   * path, with a provider at the end of it.
   */
  it("runs a media tool in the worker even when no provider can serve it", async () => {
    const owner = String(process.env.LIVE_RUN_USER);
    const model = process.env.LIVE_RUN_MODEL || "zai-web/glm-5-turbo";
    const authorization = await ownKey(owner).then((key) => (key ? `Bearer ${key}` : null));
    const sessionId = `live-media-${Date.now()}`;

    const { runId } = await withTenant(owner, () =>
      startDurableRun({
        sessionId,
        messageId: `live-media-msg-${Date.now()}`,
        body: {
          model,
          messages: [
            { role: "user", content: "Use the generate_image tool with the prompt \"a red circle\", then say what happened in one sentence." },
          ],
          tools: [IMAGE_TOOL],
          tool_choice: "auto",
        },
        authorization,
      }),
    );

    const deadline = Date.now() + 180_000;
    let run = await withTenant(owner, () => getHarnessRun(runId));
    while (run?.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      run = await withTenant(owner, () => getHarnessRun(runId));
    }

    try {
      const events = await withTenant(owner, () => listHarnessEvents(sessionId));
      const results = events.filter((event) => event.type === "tool/result");
      expect(results.length, "the media tool never ran in the worker").toBeGreaterThan(0);
      expect(results.every((event) => event.data.ranOn === "server")).toBe(true);
      // The result came from this side's catalogue read, not from a browser.
      // With an image provider on the account (LIVE_EXPECT_IMAGE=1) it has to
      // be an image; without one, the explained failure.
      const content = String(results[0]?.data.content ?? "");
      if (process.env.LIVE_EXPECT_IMAGE === "1") {
        expect(content, content.slice(0, 400)).toMatch(/"b64_json"|"url"/);
      } else {
        expect(content).toMatch(/image generation provider|attempts|"b64_json"|"url"/i);
      }
    } finally {
      await withTenant(owner, () => deleteHarnessRuns([runId])).catch(() => undefined);
    }
  }, 240_000);
});
