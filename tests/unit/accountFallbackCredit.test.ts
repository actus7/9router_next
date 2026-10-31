import { describe, expect, it } from "vitest";

import { checkFallbackError, isClientRequestError } from "@/server/llm-gateway/engine/services/accountFallback";
import { COOLDOWN } from "@/server/llm-gateway/engine/config/errorConfig";

// Anthropic answers an empty balance with HTTP 400, not 402. That is the status
// the client-error rule (400/413/422 = "the body is wrong") would otherwise claim.
const ANTHROPIC_NO_CREDIT = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

describe("credit exhaustion is billing, whatever the status", () => {
  it.each([
    "You have insufficient credits to make this request. Please purchase more credits to continue using the service.",
    "Insufficient credit balance",
    ANTHROPIC_NO_CREDIT,
  ])("classifies a 400 as billing with the long cooldown: %s", (message) => {
    expect(checkFallbackError(400, message)).toEqual({
      shouldFallback: true,
      cooldownMs: COOLDOWN.billing,
    });
  });

  it("does not treat a 400 that says the account has no credit as the caller's fault", () => {
    expect(isClientRequestError(400, ANTHROPIC_NO_CREDIT)).toBe(false);
    expect(isClientRequestError(400, "Insufficient credits")).toBe(false);
  });

  it("still treats an ordinary bad request as the caller's fault", () => {
    expect(isClientRequestError(400, "Bad request")).toBe(true);
  });
});
