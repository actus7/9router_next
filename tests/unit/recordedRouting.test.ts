import { describe, expect, it } from "vitest";
import { buildRequestDetail, extractRequestConfig } from "@/server/llm-gateway/engine/handlers/chatCore/requestDetail";
import { attachRoutingDecision } from "@/server/llm-gateway/engine/services/smart-routing/context";

// Found by gatewayDockerLive: the full decision (248 candidates, each with its
// details) made a two-line prompt's stored request 29 KB, past the record's
// size cap — so it was truncated and the drawer's "why this path" never showed.
function routedBody(candidates: number) {
  const body: Record<string, unknown> = { model: "dev", messages: [{ role: "user", content: "hi" }] };
  const models = Array.from({ length: candidates }, (_, i) => `p/model-${i}`);
  attachRoutingDecision(body, {
    comboName: "dev", need: "general", tier: "reasoning", confidence: 0.9, reason: "proof", classifierSource: "jev",
    candidates: models,
    candidateDetails: models.map((model) => ({ model, tier: "reasoning", degraded: false, source: "manual", score: 2 })),
  } as never);
  return body;
}

describe("the routing decision a request detail keeps", () => {
  it("keeps the reasoning and the top candidates, not the whole candidate list", () => {
    const routing = extractRequestConfig(routedBody(248), true).routing as Record<string, unknown>;
    expect(routing).toMatchObject({ need: "general", tier: "reasoning", confidence: 0.9, reason: "proof", classifierSource: "jev" });
    expect(routing.candidateDetails).toBeUndefined();
    expect((routing.candidates as string[]).length).toBe(10);
    expect(JSON.stringify(routing).length).toBeLessThan(2_000);
  });

  it("is also kept at the top of the detail, so truncating a large request does not lose it", () => {
    const request = extractRequestConfig(routedBody(3), true);
    const detail = buildRequestDetail({ provider: "p", model: "m", request } as never);
    expect(detail.routing).toMatchObject({ tier: "reasoning", classifierSource: "jev" });
  });
});
