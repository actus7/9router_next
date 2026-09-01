export const DUCKAI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

export type VqdChallengeResult = {
  server_hashes: string[];
  client_hashes: string[];
  signals: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type DuckAiChallengeRuntime = "browser" | "jsdom-dangerous" | "off";


