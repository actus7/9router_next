// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const parses = vi.hoisted(() => ({ count: 0 }));

// Counting how often markdown is parsed is the whole point of the memo.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    parses.count += 1;
    return <p>{children}</p>;
  },
}));

import SafeMarkdown from "@/shared/components/SafeMarkdown";

afterEach(() => {
  cleanup();
  parses.count = 0;
});

describe("SafeMarkdown", () => {
  it("does not re-parse when the parent re-renders with the same source", () => {
    const { rerender } = render(<SafeMarkdown source="# same" className="a" />);
    rerender(<SafeMarkdown source="# same" className="a" />);
    rerender(<SafeMarkdown source="# same" className="a" />);

    expect(parses.count).toBe(1);
  });

  it("re-parses when the source changes", () => {
    const { rerender, container } = render(<SafeMarkdown source="one" />);
    rerender(<SafeMarkdown source="one two" />);

    expect(parses.count).toBe(2);
    expect(container.textContent).toBe("one two");
  });

  it("re-renders when only the className changes", () => {
    const { rerender, container } = render(<SafeMarkdown source="x" className="a" />);
    rerender(<SafeMarkdown source="x" className="b" />);

    expect(container.firstElementChild?.className).toContain("b");
  });
});
