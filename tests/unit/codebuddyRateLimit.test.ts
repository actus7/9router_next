import { describe, expect, it } from "vitest";

import { CodeBuddyExecutor } from "@/server/llm-gateway/engine/executors/codebuddy-cn";
import { CodeBuddyIntlExecutor } from "@/server/llm-gateway/engine/executors/codebuddy-intl";
import { parseCodeBuddyFrequencyLimit } from "@/server/llm-gateway/engine/executors/codebuddyErrors";

// CodeBuddy answers its frequency limit with code 6004 and the reset time inside the
// message text. Without reading it the account got the generic backoff instead of
// staying out until the moment the provider says it reopens.
const body = (msg: string, code: number | string = 6004): string => JSON.stringify({ code, msg });

describe("parseCodeBuddyFrequencyLimit", () => {
  it("turns code 6004 into a 429 with the reset time from the message (default UTC+8)", () => {
    const parsed = parseCodeBuddyFrequencyLimit(body("超出频率限制，将于 2026-10-24 10:00:00 恢复"));

    expect(parsed?.status).toBe(429);
    expect(parsed?.resetsAtMs).toBe(Date.parse("2026-10-24T10:00:00+08:00"));
  });

  it("honours an explicit UTC offset, in whole hours or with minutes", () => {
    expect(parseCodeBuddyFrequencyLimit(body("frequency limit, resets at 2026-10-24 10:00:00 UTC+5"))?.resetsAtMs)
      .toBe(Date.parse("2026-10-24T10:00:00+05:00"));
    expect(parseCodeBuddyFrequencyLimit(body("frequency limit, resets at 2026-10-24 10:00:00 UTC+05:30"))?.resetsAtMs)
      .toBe(Date.parse("2026-10-24T10:00:00+05:30"));
  });

  it("recognises the frequency-limit wording even without the code", () => {
    expect(parseCodeBuddyFrequencyLimit(body("Request exceeds the frequency limit", 0))?.status).toBe(429);
    expect(parseCodeBuddyFrequencyLimit(body("今日限额已用完", 0))?.status).toBe(429);
  });

  it("is still a 429 when the message carries no time, with no reset to promise", () => {
    const parsed = parseCodeBuddyFrequencyLimit(body("frequency limit"));

    expect(parsed?.status).toBe(429);
    expect(parsed?.resetsAtMs).toBeNull();
  });

  it("leaves any other error, and a body that is not JSON, to the default parsing", () => {
    expect(parseCodeBuddyFrequencyLimit(body("invalid request", 11101))).toBeNull();
    expect(parseCodeBuddyFrequencyLimit("<html>502</html>")).toBeNull();
    expect(parseCodeBuddyFrequencyLimit("")).toBeNull();
  });
});

describe("CodeBuddy executors", () => {
  it.each([
    ["codebuddy-cn", new CodeBuddyExecutor()],
    ["codebuddy-intl", new CodeBuddyIntlExecutor()],
  ])("%s reports the 6004 limit with its reset time", (_name, executor) => {
    const parsed = executor.parseError(new Response("", { status: 400 }), body("frequency limit 2026-10-24 10:00:00 UTC+8")) as unknown as { status: number; resetsAtMs: number };

    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBe(Date.parse("2026-10-24T10:00:00+08:00"));
  });

  it("falls back to the default for other errors", () => {
    const parsed = new CodeBuddyIntlExecutor().parseError(new Response("", { status: 400 }), body("bad", 11101));

    expect(parsed.status).toBe(400);
  });
});
