// Host adapter — the Synapse Loop (learned local answers, per account).
//
// The engine asks two things of it: "is there a learned answer for this turn?"
// before dispatch, and "here is what the LLM answered" after. Observation runs
// under waitUntil — reading a JSON body included — so it never delays a
// response and isn't cut off when the invocation returns. Failures are
// swallowed: learning is an optimization, never a reason for a request to fail.
import { waitUntil } from "@vercel/functions";
import { lookupLearned, observeAnswer, type LoopOptions, type ObservedTurn } from "@/server/synapse/loop";
import { answerOf } from "../utils/answerText";

export { lookupLearned };

export function observeInBackground(turn: ObservedTurn, opts: LoopOptions): void {
  waitUntil(observeAnswer(turn, opts).catch(() => undefined));
}

/** Observe a complete JSON response (any dialect); pass a clone, the original goes to the client. */
export function observeResponseInBackground(response: Response, turn: Omit<ObservedTurn, "answer">, opts: LoopOptions): void {
  waitUntil((async () => {
    const { text, sawToolCall } = answerOf(await response.json());
    if (!sawToolCall && text.trim()) await observeAnswer({ ...turn, answer: text }, opts);
  })().catch(() => undefined));
}
