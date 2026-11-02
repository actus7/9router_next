// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelScopeButton } from "@/app/(dashboard)/dashboard/combos/[id]/ModelScopeCard";

afterEach(cleanup);

function renderButton(overrides: Partial<Parameters<typeof ModelScopeButton>[0]> = {}) {
  const props = {
    selected: true,
    onSelectedChange: vi.fn(),
    models: ["ag/claude-opus-4-6", "toll/claude_opus_4"],
    onRemoveModel: vi.fn(),
    onAddClick: vi.fn(),
    ...overrides,
  };
  render(<ModelScopeButton {...props} />);
  return props;
}

describe("ModelScopeButton", () => {
  it("summarises the model set on the button and keeps the list closed", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /Combo models.*Chosen models: 2/ })).toBeTruthy();
    expect(screen.queryByText("ag/claude-opus-4-6")).toBeNull();
  });

  it("opens the dialog to switch scope, add and remove models", () => {
    const props = renderButton();
    fireEvent.click(screen.getByRole("button", { name: /Combo models/ }));

    fireEvent.click(screen.getByRole("button", { name: /All available models/ }));
    expect(props.onSelectedChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Remove ag/claude-opus-4-6" }));
    expect(props.onRemoveModel).toHaveBeenCalledWith("ag/claude-opus-4-6");

    fireEvent.click(screen.getByRole("button", { name: /Add model/ }));
    expect(props.onAddClick).toHaveBeenCalled();
  });
});
