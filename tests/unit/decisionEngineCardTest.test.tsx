// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DecisionEngineCard from "@/app/(dashboard)/dashboard/profile/sections/DecisionEngineCard";

type Engine = Parameters<typeof DecisionEngineCard>[0]["engine"];

function engine(overrides: Partial<Engine> = {}): Engine {
  return {
    hasGatewayKey: true,
    connecting: false,
    error: null,
    setEngine: vi.fn(),
    setFeature: vi.fn(),
    connectGatewayKey: vi.fn(),
    testing: false,
    testResult: null,
    testJev: vi.fn(),
    ...overrides,
  } as Engine;
}

const settings = { decisionEngine: "jev" } as never;

describe("DecisionEngineCard — Testar Jev", () => {
  afterEach(cleanup);
  it("oferece o teste quando há chave e dispara a chamada", () => {
    const e = engine();
    render(<DecisionEngineCard settings={settings} loading={false} engine={e} />);
    fireEvent.click(screen.getByRole("button", { name: /test jev/i }));
    expect(e.testJev).toHaveBeenCalled();
  });

  it("free tier: explica e aponta para pôr créditos", () => {
    render(<DecisionEngineCard settings={settings} loading={false} engine={engine({ testResult: { ok: false, reason: "free_tier", status: 403, message: "Free tier users…" } })} />);
    expect(screen.getByRole("status").textContent).toMatch(/free tier/i);
    expect(screen.getByRole("link", { name: /add credits/i }).getAttribute("href")).toContain("top-up");
  });

  it("sucesso mostra a latência", () => {
    render(<DecisionEngineCard settings={settings} loading={false} engine={engine({ testResult: { ok: true, latencyMs: 412 } })} />);
    expect(screen.getByRole("status").textContent).toMatch(/412/);
  });
});
