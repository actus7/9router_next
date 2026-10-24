// The bookkeeping of a combo hedge: who won, how to stop the attempt that did not,
// and how to wait for the first answer. Pure functions, kept out of combo.ts.

/** One hedge: who won, and how to stop the attempt that did not. */
export interface HedgeRace {
  /** The attempt that opened the race; only it may end the race with a request-level error. */
  primary: number;
  winner: number | null;
  controllers: Map<number, AbortController>;
}

/** The first attempt to hand back a response wins; the others are aborted. */
export function claimRace(race: HedgeRace, attempt: number): boolean {
  if (race.winner === null) {
    race.winner = attempt;
    for (const [other, controller] of race.controllers) if (other !== attempt) controller.abort();
  }
  return race.winner === attempt;
}

/** First non-null response; null once every attempt has settled without one. */
export function firstResponse(attempts: Promise<Response | null>[]): Promise<Response | null> {
  return new Promise((resolve) => {
    let pending = attempts.length;
    const settle = (response: Response | null): void => {
      if (response) resolve(response);
      else if (--pending === 0) resolve(null);
    };
    for (const attempt of attempts) attempt.then(settle, () => settle(null));
  });
}

/** Close the stream of an attempt that lost, so its upstream is not read (or paid for) any further. */
export function discardResponse(response: Response | undefined): void {
  response?.body?.cancel().catch(() => {});
}
