// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SynapseLearningSection from "@/app/(dashboard)/dashboard/token-saver/sections/SynapseLearningSection";

type Learning = Parameters<typeof SynapseLearningSection>[0]["learning"];

const cap = (over: Record<string, unknown> = {}) => ({
  id: "c1", key: "k", personaHash: "p", canonicalInput: "Qual é a capital da França?", answer: "Paris.",
  status: "active", shadowRuns: 10, shadowAgreements: 10, served: 7, rejections: 0, source: "heuristic",
  createdAt: "", updatedAt: "", ...over,
});

function learning(over: Partial<Learning> = {}): Learning {
  return {
    enabled: true, saving: false, capabilities: [cap()] as never, loading: false,
    setEnabled: vi.fn(), retire: vi.fn(), reactivate: vi.fn(), remove: vi.fn(), forgetAll: vi.fn(),
    ...over,
  } as Learning;
}

describe("SynapseLearningSection", () => {
  afterEach(cleanup);

  it("liga/desliga o aprendizado automático", () => {
    const l = learning({ enabled: false });
    render(<SynapseLearningSection learning={l} />);
    fireEvent.click(screen.getByRole("switch", { name: /automatic learning/i }));
    expect(l.setEnabled).toHaveBeenCalledWith(true);
  });

  it("lista o que aprendeu com status e números, e permite aposentar", () => {
    const l = learning();
    render(<SynapseLearningSection learning={l} />);
    expect(screen.getByText("Qual é a capital da França?")).toBeTruthy();
    expect(screen.getByText(/active/i)).toBeTruthy();
    expect(screen.getByText(/7/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retire/i }));
    expect(l.retire).toHaveBeenCalledWith("c1");
  });

  it("aposentada pode ser reativada", () => {
    const l = learning({ capabilities: [cap({ status: "deprecated" })] as never });
    render(<SynapseLearningSection learning={l} />);
    fireEvent.click(screen.getByRole("button", { name: /reactivate/i }));
    expect(l.reactivate).toHaveBeenCalledWith("c1");
  });

  it("esquecer tudo pede confirmação", () => {
    const l = learning();
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<SynapseLearningSection learning={l} />);
    fireEvent.click(screen.getByRole("button", { name: /forget everything/i }));
    expect(l.forgetAll).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
