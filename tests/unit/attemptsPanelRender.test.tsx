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

import RequestAttemptsPanel from "@/app/(dashboard)/dashboard/usage/components/requests/RequestAttemptsPanel";
import { ModelHealthPanel } from "@/app/(dashboard)/dashboard/combos/ModelHealthPanel";

afterEach(cleanup);

describe("RequestAttemptsPanel", () => {
  const attempts = [
    { model: "zai/glm-5.3-flashx", provider: "zai", outcome: "failed" as const, status: 429, errorClass: "rate_limit", error: "Your current subscription plan does not yet include access", durationMs: 1479, startOffsetMs: 0 },
    { model: "opencode-go/space-bunny-free", provider: "opencode-go", outcome: "failed" as const, status: 400, durationMs: 300, startOffsetMs: 1500 },
    { model: "mimo-v2.6-flash", provider: "mimo", outcome: "ok" as const, status: 200, durationMs: 900, startOffsetMs: 1800 },
  ];

  it("lists every attempt in order with its status and explains the first failure by default", () => {
    render(<RequestAttemptsPanel attempts={attempts} />);
    const items = screen.getAllByRole("button");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("zai/glm-5.3-flashx");
    expect(items[0].textContent).toContain("429");
    expect(items[2].textContent).toContain("200");
    // Detail pane shows the failed attempt's error and where it fell back to.
    expect(screen.getByText(/does not yet include access/)).toBeTruthy();
    expect(screen.getByText(/Continued with fallback to/)).toBeTruthy();
    expect(screen.getAllByText("opencode-go/space-bunny-free").length).toBeGreaterThan(1);
  });

  it("switches the detail when another attempt is selected", () => {
    render(<RequestAttemptsPanel attempts={attempts} />);
    fireEvent.click(screen.getAllByRole("button")[2]);
    expect(screen.queryByText(/does not yet include access/)).toBeNull();
    expect(screen.getByText("Success")).toBeTruthy();
  });

  it("renders nothing without attempts", () => {
    const { container } = render(<RequestAttemptsPanel attempts={undefined} />);
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
