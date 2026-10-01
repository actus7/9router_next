import "server-only";

import { decideWithJev, type JevQuestion } from "@/server/decisions/jev";

// A past-session search is ranked by text relevance, which happily answers
// "how do I deploy?" with a message that merely contains both words. Jev
// scores each snippet against the actual question instead, one typed call for
// the whole batch. Null (or anything weak) keeps the search's own ranking:
// the ordering is a preference, not a gate.

const RERANK_TIMEOUT_MS = 2_000;
const MAX_SNIPPET_CHARS = 600;

/**
 * Returns `hits` reordered by how well each snippet answers `query`.
 * Stable: equal scores keep the search engine's order. Never throws.
 */
export async function rerankSessionHits<T extends { snippet: string }>(query: string, hits: T[]): Promise<T[]> {
  if (hits.length <= 1) return hits;

  const questions: Record<string, JevQuestion> = {};
  hits.forEach((_hit, index) => {
    questions[`r${index}`] = {
      type: "score",
      instructions: "How well does this snippet answer the question?",
      criteria: ["Irrelevant", "Partially relevant", "Relevant", "Directly answers it"],
    };
  });

  const decision = await decideWithJev(
    "rerank",
    { question: query, snippets: hits.map((hit) => hit.snippet.slice(0, MAX_SNIPPET_CHARS)) },
    questions,
    { timeoutMs: RERANK_TIMEOUT_MS },
  );
  if (!decision) return hits;

  return hits
    .map((hit, index) => {
      const answer = decision.answers[`r${index}`];
      return { hit, index, score: answer?.type === "score" ? answer.score : Number.NEGATIVE_INFINITY };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.hit);
}
