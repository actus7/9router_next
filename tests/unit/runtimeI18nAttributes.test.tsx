// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { initRuntimeI18n, seedRuntimeI18n } from "@/i18n/runtime";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await frame();
  await frame();
};

function Toolbar() {
  return (
    <div>
      <input placeholder="Search providers..." aria-label="Search providers..." />
      <button title="Copy model value" type="button">
        Copy
      </button>
      <span data-i18n-skip="true" title="Copy model value">
        raw
      </span>
    </div>
  );
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  document.cookie = "locale=pt-BR";
  seedRuntimeI18n("pt-BR", {
    "Search providers...": "Pesquisar provedores...",
    "Copy model value": "Copiar valor do modelo",
    Copy: "Copiar",
  });
  await initRuntimeI18n();
});

/**
 * A sentence reaches the user through a tooltip or a field hint just as often as
 * through a text node. Translating only text nodes left every `title`,
 * `placeholder` and `aria-label` in English no matter what the dictionary said.
 */
describe("runtime i18n attributes", () => {
  it("translates title, placeholder and aria-label once React has claimed the element", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Toolbar />);
    document.body.appendChild(container);

    const input = container.querySelector("input")!;
    await settle();
    // Untouched until React owns the node — same gate the text path uses.
    expect(input.getAttribute("placeholder")).toBe("Search providers...");

    await act(async () => {
      hydrateRoot(container, <Toolbar />);
    });
    await settle();

    expect(input.getAttribute("placeholder")).toBe("Pesquisar provedores...");
    expect(input.getAttribute("aria-label")).toBe("Pesquisar provedores...");
    expect(container.querySelector("button")!.getAttribute("title")).toBe(
      "Copiar valor do modelo",
    );
  });

  it("honours data-i18n-skip on attributes", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Toolbar />);
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <Toolbar />);
    });
    await settle();

    expect(container.querySelector("span")!.getAttribute("title")).toBe("Copy model value");
  });
});
