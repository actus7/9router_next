import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import SafeMarkdown from "@/shared/components/SafeMarkdown";

function renderMarkdown(source: string): Document {
  const markup = renderToStaticMarkup(createElement(SafeMarkdown, { source }));
  return new JSDOM(markup).window.document;
}

describe("SafeMarkdown", () => {
  it("never turns raw HTML or event handlers into executable DOM", () => {
    const document = renderMarkdown([
      '<script>globalThis.pwned = true</script>',
      '<img src="x" onerror="globalThis.pwned = true">',
      '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    ].join("\n"));

    expect(document.querySelector("script, img, svg")).toBeNull();
    expect(document.querySelector("[onerror], [onclick], [xlink\\:href]")).toBeNull();
  });

  it("removes dangerous link protocols", () => {
    const document = renderMarkdown([
      "[javascript](javascript:alert(1))",
      "[data](data:text/html,<script>alert(1)</script>)",
      "[safe](https://example.com/docs)",
    ].join("\n"));
    const links = [...document.querySelectorAll("a")];

    expect(links.some((link) => /^(javascript|data):/i.test(link.getAttribute("href") ?? ""))).toBe(false);
    const safeLink = links.find((link) => link.textContent === "safe");
    expect(safeLink?.getAttribute("href")).toBe("https://example.com/docs");
    expect(safeLink?.getAttribute("rel")).toContain("noopener");
  });

  it("preserves GFM tables and code blocks", () => {
    const document = renderMarkdown("| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst ok = true\n```");

    expect(document.querySelector("table")).not.toBeNull();
    expect(document.querySelector("code.language-ts")?.textContent).toContain("const ok = true");
  });
});
