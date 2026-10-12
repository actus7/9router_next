import { describe, expect, it } from "vitest";
import { CODEX_CLIENT_VERSION } from "@/server/llm-gateway/engine/providers/codexClientVersion";
import { CODEX_MODELS_URL } from "@/server/application/use-cases/http/providers/[id]/models/providerModelsParsers";
import codex from "@/server/llm-gateway/engine/providers/registry/codex";

/**
 * /codex/models hides every model whose minimal_client_version is above the
 * client_version we send, answering 200 with a shorter list. At 0.144.6 the
 * GPT-6 family never reached the catalogue while the Codex CLI (0.162.1) listed
 * it. One constant for the listing and the request headers, so they cannot
 * drift apart again.
 */
describe("Codex client version", () => {
  it("is recent enough to list the GPT-6 family", () => {
    const [major, minor] = CODEX_CLIENT_VERSION.split(".").map(Number);
    expect(major > 0 || minor >= 162).toBe(true);
  });

  it("is the same in the model listing and the request User-Agent", () => {
    expect(CODEX_MODELS_URL).toContain(`client_version=${CODEX_CLIENT_VERSION}`);
    expect(codex.transport.headers["User-Agent"]).toBe(`codex_cli_rs/${CODEX_CLIENT_VERSION}`);
  });
});
