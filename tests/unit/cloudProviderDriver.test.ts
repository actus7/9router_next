import { describe, expect, it } from "vitest";
import {
  CloudProviderError, CloudProviderErrorType, formatCloudProviderError, generateResourceName,
} from "@/server/cloud/providers/driver";

describe("formatCloudProviderError", () => {
  it("covers every CloudProviderErrorType with a pt-BR message", () => {
    for (const type of Object.values(CloudProviderErrorType)) {
      const error = new CloudProviderError(type, "render", "raw message");
      const message = formatCloudProviderError(error);
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("includes the retry delay for rate limit errors", () => {
    const error = new CloudProviderError(CloudProviderErrorType.RATE_LIMIT, "railway", "rate limited", undefined, 4000);
    expect(formatCloudProviderError(error)).toContain("4 segundos");
  });
});

describe("generateResourceName", () => {
  it("prefixes the tool id with squid-", () => {
    expect(generateResourceName("openclaw")).toBe("squid-openclaw");
  });
});
