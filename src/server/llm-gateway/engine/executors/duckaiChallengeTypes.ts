// The challenge hashes navigator.userAgent, and DuckDuckGo re-checks that hash
// against the User-Agent on the chat request — so the value the browser reports
// and the value Node sends have to be this one string. A stale major version
// gets the chat rejected with 418 ERR_CHALLENGE, so keep it current (or bump it
// with DUCKAI_USER_AGENT without a code change).
export const DUCKAI_USER_AGENT =
  process.env.DUCKAI_USER_AGENT?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

export type VqdChallengeResult = {
  server_hashes: string[];
  client_hashes: string[];
  signals: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type DuckAiChallengeRuntime = "browser" | "jsdom-dangerous" | "off";


