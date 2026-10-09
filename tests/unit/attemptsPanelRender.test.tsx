// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("swr", () => ({
  default: vi.fn(() => ({
    data: {
      models: [
        { model: "zai/glm", state: "cooldown", penalty: 3, successRate: 0.5, samples: 20, p50Ms: 1200, p95Ms: 9000, accounts: 2, cooldownAccounts: 2, cooldownUntil: new Date(Date.now() + 300_000).toISOString(), reason: "rate_limit" },
        { model: "mimo/flash", state: "ok", penalty: 0, successRate: 0.99, samples: 300, p50Ms: 250, p95Ms: 500, accounts: 1, cooldownAccounts: 0 },
      ],
    },
    mutate: vi.fn(async () => {}),
    isLoading: false,
  })),
}));

import RequestRoutingStory from "@/app/(dashboard)/dashboard/usage/components/requests/RequestRoutingStory";
import { ModelHealthPanel } from "@/app/(dashboard)/dashboard/combos/ModelHealthPanel";

afterEach(cleanup);

describe("RequestRoutingStory", () => {
  const attempts = [
    { model: "zai/glm-5.3-flashx", provider: "zai", outcome: "failed" as const, status: 429, errorClass: "rate_limit", error: "Your current subscription plan does not yet include access", durationMs: 1479, startOffsetMs: 0 },
    { model: "opencode-go/space-bunny-free", provider: "opencode-go", outcome: "failed" as const, status: 400, durationMs: 300, startOffsetMs: 1500 },
    { model: "mimo-v2.6-flash", provider: "mimo", outcome: "ok" as const, status: 200, durationMs: 900, startOffsetMs: 1800 },
  ];

  it("headlines who answered and after how many failures, then lists every attempt with its reason", () => {
    render(<RequestRoutingStory routing={{ attempts, combo: "dev", tier: "simple" }} />);
    expect(screen.getByRole("heading").textContent).toBe("Answered by mimo-v2.6-flash after 2 failed attempts");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Rate limit or quota exhausted (429)")).toBeTruthy();
    expect(screen.getByText(/does not yet include access/)).toBeTruthy();
    expect(screen.getByText(/combo: dev · tier: Simple/)).toBeTruthy();
    expect(screen.getByText("Answered the request")).toBeTruthy();
  });

  it("explains a hedge loser as cancelled, not as a failure", () => {
    render(
      <RequestRoutingStory
        routing={{
          attempts: [
            { model: "mimo/pro", outcome: "ok", status: 200, startOffsetMs: 0, durationMs: 9800 },
            { model: "mimo/flash", outcome: "aborted", error: "another model answered first", startOffsetMs: 6000, durationMs: 4300 },
          ],
        }}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Answered by mimo/pro on the first try");
    expect(screen.getByText(/Not a failure/)).toBeTruthy();
    expect(screen.getByText("in parallel")).toBeTruthy();
    expect(screen.queryByText("another model answered first")).toBeNull();
  });

  it("names the free fallback as the one that answered, not the model that ran out of accounts", () => {
    render(
      <RequestRoutingStory
        routing={{
          attempts: [
            { model: "glm/glm-5.3-flash", outcome: "failed", status: 429, errorClass: "rate_limit", error: "Insufficient balance" },
            { model: "kilo-gateway/kilo-auto/free", outcome: "ok", freeFallback: true },
          ],
        }}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Answered by kilo-gateway/kilo-auto/free (free fallback) after 1 failed attempt");
    expect(screen.getByText(/Answered by the free fallback, because the model before it had no account left/)).toBeTruthy();
  });

  it("shows provider names, the readable error, an account switch and why smart routing chose the path", () => {
    render(
      <RequestRoutingStory
        routing={{
          attempts: [
            { model: "glm/glm-5.3-flash", provider: "glm", connection: "Z.ai", outcome: "failed", status: 429, errorClass: "rate_limit", error: '[429]: {"error":{"code":"1113","message":"Insufficient balance"}}' },
            { model: "glm/glm-5.3-flash", provider: "glm", connection: "Z.ai 2", outcome: "ok", status: 200 },
          ],
          tier: "simple",
        }}
        decision={{ need: "tool_use", tier: "simple", confidence: 0.82, reason: "short prompt" }}
        providerNames={{ glm: "GLM (Zhipu)" }}
      />,
    );
    expect(screen.getByText("GLM (Zhipu) · Z.ai")).toBeTruthy();
    expect(screen.getByText("Insufficient balance")).toBeTruthy();
    expect(screen.getByText("Original error")).toBeTruthy();
    expect(screen.getByText("Then tried another account of the same model")).toBeTruthy();
    expect(screen.getByText(/Task: Tool use · Confidence: 82% · short prompt/)).toBeTruthy();
    expect(screen.getByText(/tier: Simple/)).toBeTruthy();
  });

  it("says so when nothing answered", () => {
    render(<RequestRoutingStory routing={{ attempts: [{ model: "a/m", outcome: "failed", status: 503 }] }} />);
    expect(screen.getByRole("heading").textContent).toBe("No model answered");
  });

  it("renders nothing without routing information", () => {
    const { container } = render(<RequestRoutingStory routing={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ModelHealthPanel", () => {
  it("shows each model's state, success rate and percentiles, and asks before resetting", async () => {
    const onRequestReset = vi.fn();
    render(<ModelHealthPanel onRequestReset={onRequestReset} />);
    expect(screen.getByText("zai/glm")).toBeTruthy();
    expect(screen.getByText(/In cooldown/)).toBeTruthy();
    expect(screen.getByText("99%")).toBeTruthy();
    expect(screen.getByText("250ms / 500ms")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    await waitFor(() => expect(onRequestReset).toHaveBeenCalledTimes(1));
  });
});
