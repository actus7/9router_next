// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LearnedAnswersCard from "@/app/(dashboard)/dashboard/endpoint/sections/LearnedAnswersCard";
import ApiKeysCard from "@/app/(dashboard)/dashboard/endpoint/sections/ApiKeysCard";

vi.mock("@/app/(dashboard)/dashboard/endpoint/sections/KeyAccessButton", () => ({
  default: () => null,
}));

type Learning = Parameters<typeof LearnedAnswersCard>[0]["learning"];

const cap = {
  id: "c1", key: "k", personaHash: "p", canonicalInput: "Qual é a capital da França?", answer: "Paris.",
  status: "active", shadowRuns: 10, shadowAgreements: 10, served: 7, rejections: 0, source: "heuristic",
  createdAt: "", updatedAt: "",
};

function learning(over: Partial<Learning> = {}): Learning {
  return {
    capabilities: [cap] as never, loading: false, loadError: false,
    retire: vi.fn(async () => true), reactivate: vi.fn(async () => true),
    remove: vi.fn(async () => true), forgetAll: vi.fn(async () => true),
    ...over,
  } as Learning;
}

describe("LearnedAnswersCard failure feedback", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("a refused delete says so in the card", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const l = learning({ remove: vi.fn(async () => false) });
    render(<LearnedAnswersCard learning={l} />);

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(l.remove).toHaveBeenCalledWith("c1");
  });

  it("delete does nothing when the user cancels the confirmation", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const l = learning();
    render(<LearnedAnswersCard learning={l} />);

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(l.remove).not.toHaveBeenCalled();
  });

  it("a failed load is shown instead of the empty-state message", () => {
    render(<LearnedAnswersCard learning={learning({ capabilities: [] as never, loadError: true })} />);

    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    expect(screen.queryByText(/nothing learned yet/i)).toBeNull();
  });
});

describe("ApiKeysCard load error", () => {
  afterEach(cleanup);

  const base = {
    keys: [], isRemoteHost: false, visibleKeys: new Set<string>(), copied: null, copy: vi.fn(),
    maskKey: (k: string) => k, toggleKeyVisibility: vi.fn(), setConfirmState: vi.fn(),
    handleToggleKey: vi.fn(), handleDeleteKey: vi.fn(), onOpenProfile: vi.fn(),
    setShowAddModal: vi.fn(),
  };

  it("offers a retry instead of the 'No API keys yet' empty state", () => {
    const onRetry = vi.fn();
    render(<ApiKeysCard {...base} loadError onRetry={onRetry} />);

    expect(screen.queryByText(/no api keys yet/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the empty state when the list really loaded empty", () => {
    render(<ApiKeysCard {...base} loadError={false} onRetry={vi.fn()} />);

    expect(screen.getByText(/no api keys yet/i)).toBeTruthy();
  });
});
