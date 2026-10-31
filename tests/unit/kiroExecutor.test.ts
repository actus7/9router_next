import { describe, expect, it } from "vitest";

import { KiroExecutor } from "@/server/llm-gateway/engine/executors/kiro";
import type { Credentials } from "@/server/llm-gateway/engine/services/types";

const RUNTIME = "https://runtime.us-east-1.kiro.dev/generateAssistantResponse";
const CODEWHISPERER = "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse";
const Q = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";

function credentialsFor(authMethod: string | null): Credentials {
  return {
    accessToken: "token",
    providerSpecificData: authMethod ? { authMethod } : {},
  } as unknown as Credentials;
}

describe("KiroExecutor.getOrderedBaseUrls", () => {
  // Measured live on 2026-10-31 (kiroLive.test.ts): builder-id and social
  // tokens get 200 from all three surfaces, so runtime.kiro.dev stays first —
  // a 400 is terminal in BaseExecutor, and the amazonaws surfaces are the ones
  // documented to answer REQUEST_BODY_INVALID for some payloads.
  it("keeps runtime.kiro.dev first for builder-id and social tokens", () => {
    for (const method of ["builder-id", "social"]) {
      expect(new KiroExecutor().getOrderedBaseUrls(credentialsFor(method))[0]).toBe(RUNTIME);
    }
  });

  it("sends AWS SSO-family tokens to the amazonaws surfaces before runtime.kiro.dev", () => {
    for (const method of ["api_key", "external_idp", "idc"]) {
      const urls = new KiroExecutor().getOrderedBaseUrls(credentialsFor(method));
      expect(urls[0]).not.toBe(RUNTIME);
    }
  });

  it("still lists every surface exactly once when authMethod is missing", () => {
    const urls = new KiroExecutor().getOrderedBaseUrls(credentialsFor(null));

    expect([...urls].sort()).toEqual([RUNTIME, CODEWHISPERER, Q].sort());
  });
});
