import { beforeEach, describe, expect, it, vi } from "vitest";

// Past-session hits reranked by whether the snippet answers the question,
// not by word overlap. Null keeps the search engine's order: reranking is a
// preference, never a gate.

const decideWithJev = vi.hoisted(() => vi.fn());
vi.mock("@/server/decisions/jev", () => ({ decideWithJev }));

import { rerankSessionHits } from "@/server/harness/tools/rerank";

const hits = (snippets: string[]) => snippets.map((snippet, index) => ({ snippet, id: `h${index}` }));

function jevScores(...scores: number[]) {
  return {
    answers: Object.fromEntries(
      scores.map((score, index) => [`r${index}`, { type: "score", score, confidence: 0.9, probabilities: {} }]),
    ),
    source: "jev",
  };
}

beforeEach(() => decideWithJev.mockReset());

describe("rerankSessionHits", () => {
  it("orders hits by descending score", async () => {
    decideWithJev.mockResolvedValue(jevScores(1, 3, 2));
    const input = hits(["one", "two", "three"]);

    const result = await rerankSessionHits("which?", input);

    expect(result.map((hit) => hit.id)).toEqual(["h1", "h2", "h0"]);
    expect(decideWithJev.mock.calls[0]?.[0]).toBe("rerank");
  });

  it("keeps the original order between equal scores", async () => {
    decideWithJev.mockResolvedValue(jevScores(2, 2, 1));
    const input = hits(["one", "two", "three"]);

    const result = await rerankSessionHits("which?", input);

    expect(result.map((hit) => hit.id)).toEqual(["h0", "h1", "h2"]);
  });

  it("short-circuits on one hit or none", async () => {
    const empty: Array<{ snippet: string }> = [];
    const one = hits(["only"]);

    expect(await rerankSessionHits("which?", empty)).toBe(empty);
    expect(await rerankSessionHits("which?", one)).toBe(one);
    expect(decideWithJev).not.toHaveBeenCalled();
  });

  it("returns the original order when Jev does not answer", async () => {
    decideWithJev.mockResolvedValue(null);
    const input = hits(["one", "two", "three"]);

    expect(await rerankSessionHits("which?", input)).toBe(input);
  });
});
