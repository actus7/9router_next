// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LearnedAnswersCard from "@/app/(dashboard)/dashboard/endpoint/sections/LearnedAnswersCard";

type Learning = Parameters<typeof LearnedAnswersCard>[0]["learning"];

const cap = (over: Record<string, unknown> = {}) => ({
  id: "c1", key: "k", personaHash: "p", canonicalInput: "Qual é a capital da França?", answer: "Paris.",
  status: "active", shadowRuns: 10, shadowAgreements: 10, served: 7, rejections: 0, source: "heuristic",
  createdAt: "", updatedAt: "", ...over,
});

function learning(over: Partial<Learning> = {}): Learning {
  return {
    capabilities: [cap()] as never, loading: false,
    retire: vi.fn(), reactivate: vi.fn(), remove: vi.fn(), forgetAll: vi.fn(),
    ...over,
  } as Learning;
}

describe("LearnedAnswersCard", () => {
  afterEach(cleanup);

  it("não tem switch: o aprendizado liga por chave ou por conversa", () => {
    render(<LearnedAnswersCard learning={learning()} />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("sem nada aprendido, explica como começar", () => {
    render(<LearnedAnswersCard learning={learning({ capabilities: [] as never })} />);
    expect(screen.getByText(/nothing learned yet/i)).toBeTruthy();
  });

  it("lista o que aprendeu com status e números, e permite aposentar", () => {
    const l = learning();
    render(<LearnedAnswersCard learning={l} />);
    expect(screen.getByText("Qual é a capital da França?")).toBeTruthy();
    expect(screen.getByText(/active/i)).toBeTruthy();
    expect(screen.getByText(/7/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retire/i }));
    expect(l.retire).toHaveBeenCalledWith("c1");
  });

  it("aposentada pode ser reativada", () => {
    const l = learning({ capabilities: [cap({ status: "deprecated" })] as never });
    render(<LearnedAnswersCard learning={l} />);
    fireEvent.click(screen.getByRole("button", { name: /reactivate/i }));
    expect(l.reactivate).toHaveBeenCalledWith("c1");
  });

  it("esquecer tudo pede confirmação", () => {
    const l = learning();
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<LearnedAnswersCard learning={l} />);
    fireEvent.click(screen.getByRole("button", { name: /forget everything/i }));
    expect(l.forgetAll).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
