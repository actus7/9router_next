// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

// [&_svg]:shrink-0 também contém a substring, então casar a classe isolada.
const NO_SHRINK = /(?:^|\s)shrink-0(?:\s|$)/;

afterEach(cleanup);

describe("Button fullWidth", () => {
  it("allows shrinking so two fullWidth buttons split a flex row instead of overflowing", () => {
    render(
      <div className="flex flex-row">
        <Button fullWidth>Cancel</Button>
        <Button fullWidth>Create</Button>
      </div>,
    );

    for (const label of ["Cancel", "Create"]) {
      const cls = screen.getByText(label).closest("button")!.className;
      expect(cls).toContain("w-full");
      expect(NO_SHRINK.test(cls)).toBe(false);
    }
  });

  it("keeps shrink-0 when fullWidth is not set", () => {
    render(<Button>Icon</Button>);
    expect(NO_SHRINK.test(screen.getByText("Icon").closest("button")!.className)).toBe(true);
  });
});
