// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import MetaBreakSection from "@/app/(dashboard)/dashboard/token-saver/sections/MetaBreakSection";

vi.mock("@/i18n/runtime", () => ({ translate: (text: string) => text }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  return render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}><MetaBreakSection /></SWRConfig>);
}

describe("MetaBreak setting interaction", () => {
  it("uses a fixed preset without a text editor and saves only the toggle", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ metaBreakEnabled: false })).mockResolvedValueOnce(Response.json({ metaBreakEnabled: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = mount();
    await screen.findByText("MetaBreak disabled");
    expect(container.querySelector("textarea")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "MetaBreak" }));
    await screen.findByText("MetaBreak enabled for compatible requests");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ metaBreakEnabled: true });
  });
  it("keeps the previous state and displays an error when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ metaBreakEnabled: false })).mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 500 })));
    mount();
    await screen.findByText("MetaBreak disabled");
    fireEvent.click(screen.getByRole("switch", { name: "MetaBreak" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-disabled")).not.toBe("true"));
  });
  it("shows a load error with a disabled control", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 })));
    mount();
    await screen.findByRole("alert");
    expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
  });
});
