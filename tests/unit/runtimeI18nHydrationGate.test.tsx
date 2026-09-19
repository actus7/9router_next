// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initRuntimeI18n, seedRuntimeI18n } from "@/i18n/runtime";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// A streamed Suspense boundary: its HTML is in the DOM long before React can
// hydrate it, because hydration waits for the client chunk to load.
function Toolbar() {
  return <h2 id="connections-heading">Connections</h2>;
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  document.cookie = "locale=pt-BR";
  seedRuntimeI18n("pt-BR", { Connections: "Conexões" });
  await initRuntimeI18n();
});

describe("runtime i18n hydration gate", () => {
  it("leaves server HTML alone until React claims it, then translates", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Toolbar />);
    document.body.appendChild(container);

    const heading = container.querySelector("h2")!;
    await frame();
    await frame();
    expect(heading.textContent).toBe("Connections");

    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    await act(async () => {
      hydrateRoot(container, <Toolbar />);
    });
    spy.mockRestore();
    expect(JSON.stringify(errors)).not.toMatch(/hydrat/i);

    await frame();
    await frame();
    expect(heading.textContent).toBe("Conexões");
  });

  it("marks hydrated elements with a fiber, which is what the gate reads", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Toolbar />);
    document.body.appendChild(container);
    const heading = container.querySelector("h2")!;

    expect(Object.keys(heading).some((k) => k.startsWith("__reactFiber$"))).toBe(false);
    await act(async () => {
      hydrateRoot(container, <Toolbar />);
    });
    expect(Object.keys(heading).some((k) => k.startsWith("__reactFiber$"))).toBe(true);
  });
});
