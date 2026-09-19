// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, beforeAll, vi } from "vitest";
import { LanguageList } from "@/shared/components/LanguageList";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onSelect = vi.fn();
  act(() => {
    createRoot(container).render(
      <LanguageList locale="pt-BR" isPending={false} onSelect={onSelect} />,
    );
  });
  return { container, onSelect };
}

const typeSearch = (container: HTMLElement, value: string) => {
  const input = container.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const names = (container: HTMLElement) =>
  [...container.querySelectorAll("li button > span:first-of-type")].map(
    (node) => node.textContent,
  );

describe("LanguageList", () => {
  it("shows a flag image for every locale", () => {
    const { container } = render();
    const rows = container.querySelectorAll("li");
    const flags = container.querySelectorAll("li img");
    expect(rows.length).toBe(flags.length);
    expect(rows.length).toBeGreaterThan(30);
    const active = container.querySelector('li button[aria-current="true"]')!;
    expect(active.querySelector("img")!.getAttribute("src")).toBe("/flags/br.svg");
    expect(active.textContent).toContain("Português (Brasil)");
  });

  it("finds a language by its English or Portuguese name, accents optional", () => {
    const { container } = render();

    typeSearch(container, "japanese");
    expect(names(container)).toEqual(["日本語"]);

    typeSearch(container, "portugues");
    expect(names(container)).toEqual(["Português (Brasil)", "Português (Portugal)"]);

    typeSearch(container, "zzz");
    expect(container.querySelectorAll("li").length).toBe(0);
    expect(container.textContent).toContain("No language matches this search.");
  });
});
