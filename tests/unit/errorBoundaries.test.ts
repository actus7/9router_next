// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardError from "@/app/(dashboard)/error";
import GlobalError from "@/app/global-error";

afterEach(cleanup);

describe("Next.js error boundaries", () => {
  it("calls retry from the dashboard recovery action", () => {
    const retry = vi.fn();
    render(createElement(DashboardError, { error: new Error("boom"), retry }));

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders a complete global fallback document with retry support", () => {
    const markup = renderToStaticMarkup(createElement(GlobalError, {
      error: new Error("boom"),
      retry: vi.fn(),
    }));

    expect(markup).toContain("<html>");
    expect(markup).toContain("Try again");
  });
});
