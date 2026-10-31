// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store/notificationStore", () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import ModelAvailabilityBadge from "@/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge";

describe("ModelAvailabilityBadge", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a neutral status instead of 'All OK' when the availability request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    render(<ModelAvailabilityBadge />);

    expect(await screen.findByRole("button", { name: /status unavailable/i })).toBeTruthy();
    expect(screen.queryByText("All OK")).toBeNull();
  });

  it("retries the request when the neutral status is clicked", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelAvailabilityBadge />);
    fireEvent.click(await screen.findByRole("button", { name: /status unavailable/i }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
