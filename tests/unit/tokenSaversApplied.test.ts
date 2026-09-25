import { describe, expect, it } from "vitest";
import { runTokenSavers } from "@/server/llm-gateway/engine/handlers/chatCore/phases";
import { trySynapseIntercept } from "@/server/llm-gateway/engine/rtk/synapse";
import { TOKEN_SAVERS_APPLIED_HEADER, tagTokenSavers } from "@/server/llm-gateway/engine/rtk/appliedHeader";
import { TOKEN_SAVERS_APPLIED_HEADER as SHARED_HEADER, readTokenSavers } from "@/shared/chat/tokenSavers";

// O chat mostra, abaixo de cada resposta, quais economizadores de tokens de
// fato atuaram. Para isso o gateway tem de dizer — ligado não é o mesmo que usado.

const base = {
  finalFormat: "openai",
  upstreamModel: "m",
  tokenSaverEnabled: true,
  provider: "openai",
  model: "m",
  reqTag: "[t]",
};

describe("economizadores aplicados", () => {
  it("runTokenSavers lista só os que atuaram", async () => {
    const body = { messages: [{ role: "user", content: "explique closures" }] };
    const { applied } = await runTokenSavers({
      ...base, translatedBody: body, cavemanEnabled: true, cavemanLevel: "lite", ponytailEnabled: false,
    });
    expect(applied).toEqual(["caveman"]);
  });

  it("nada ligado → lista vazia", async () => {
    const { applied } = await runTokenSavers({ ...base, translatedBody: { messages: [{ role: "user", content: "x" }] } });
    expect(applied).toEqual([]);
  });

  it("a resposta do Synapse já sai marcada", () => {
    const r = trySynapseIntercept({
      body: { messages: [{ role: "user", content: "oi" }] },
      sourceFormat: "openai", stream: false, model: "m", provider: "openai",
      enabled: true, level: "lite", reqTag: "[t]",
    });
    expect(readTokenSavers(r!.response.headers)).toEqual(["synapse"]);
  });

  it("tagTokenSavers acrescenta ao header sem duplicar e ignora lista vazia", () => {
    const result = { success: true, response: new Response("{}") };
    tagTokenSavers(result, []);
    expect(result.response.headers.get(TOKEN_SAVERS_APPLIED_HEADER)).toBeNull();
    tagTokenSavers(result, ["rtk", "caveman"]);
    tagTokenSavers(result, ["caveman"]);
    expect(readTokenSavers(result.response.headers)).toEqual(["rtk", "caveman"]);
  });

  it("readTokenSavers descarta ids desconhecidos (o header vem de fora)", () => {
    expect(readTokenSavers(new Headers({ [TOKEN_SAVERS_APPLIED_HEADER]: "rtk, <script>, synapse" }))).toEqual(["synapse", "rtk"]);
  });

  it("engine e shared usam o mesmo nome de header", () => {
    expect(SHARED_HEADER).toBe(TOKEN_SAVERS_APPLIED_HEADER);
  });
});
