import { afterEach, describe, expect, it, vi } from "vitest";
import { rejectSynapseAnswer } from "@/app/(dashboard)/dashboard/basic-chat/hooks/rejectSynapseAnswer";
import type { ChatSession } from "@/app/(dashboard)/dashboard/basic-chat/types";

// 👎 or "Regenerate" on an answer Synapse served teaches the Loop the answer
// was wrong — keyed by the user's question, which is all the chat knows.
const session = (savers?: string[]) => ({
  id: "s",
  messages: [
    { id: "u1", role: "user", content: "Qual é a capital da França?" },
    { id: "a1", role: "assistant", content: "Paris.", status: "done", tokenSavers: savers },
  ],
}) as unknown as ChatSession;

describe("rejectSynapseAnswer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejeita pela pergunta quando a resposta foi do Synapse", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    rejectSynapseAnswer(session(["synapse"]), "a1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/synapse/reject");
    expect(JSON.parse(String(init.body))).toEqual({ input: "Qual é a capital da França?" });
  });

  it("não faz nada numa resposta do modelo", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    rejectSynapseAnswer(session(["rtk"]), "a1");
    rejectSynapseAnswer(session(undefined), "a1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
