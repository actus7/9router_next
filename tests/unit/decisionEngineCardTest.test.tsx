// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DecisionEngineCard from "@/app/(dashboard)/dashboard/profile/sections/DecisionEngineCard";

type Engine = Parameters<typeof DecisionEngineCard>[0]["engine"];

function engine(overrides: Partial<Engine> = {}): Engine {
  return {
    hasGatewayKey: true,
    hasTypesafeKey: false,
    connectTypesafeKey: vi.fn(async () => true),
    removeTypesafeKey: vi.fn(),
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

describe("DecisionEngineCard — chave da TypeSafe pela tela", () => {
  afterEach(cleanup);

  it("com chave da TypeSafe salva, diz que é ela que está em uso e deixa remover", () => {
    const e = engine({ hasTypesafeKey: true, hasGatewayKey: false });
    render(<DecisionEngineCard settings={settings} loading={false} engine={e} />);
    expect(screen.getByText(/Using your TypeSafe key/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove key/i }));
    expect(e.removeTypesafeKey).toHaveBeenCalled();
  });

  it("sem chave, oferece TypeSafe por padrão e salva por ela", () => {
    const e = engine({ hasTypesafeKey: false, hasGatewayKey: false });
    render(<DecisionEngineCard settings={settings} loading={false} engine={e} />);
    fireEvent.change(screen.getByLabelText(/TypeSafe API key/i), { target: { value: "ts_abc" } });
    fireEvent.click(screen.getByRole("button", { name: /save key/i }));
    expect(e.connectTypesafeKey).toHaveBeenCalledWith("ts_abc");
    expect(e.connectGatewayKey).not.toHaveBeenCalled();
  });

  it("pode trocar para a Vercel AI Gateway", () => {
    const e = engine({ hasTypesafeKey: false, hasGatewayKey: false });
    render(<DecisionEngineCard settings={settings} loading={false} engine={e} />);
    fireEvent.click(screen.getByRole("radio", { name: /Vercel AI Gateway/i }));
    expect(screen.getByLabelText(/Vercel AI Gateway API key/i)).toBeTruthy();
  });
});
