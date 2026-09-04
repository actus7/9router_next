// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormInput } from "@/shared/components/FormInput";
import { DynamicMedia, isSupportedMediaSource } from "@/shared/components/DynamicMedia";
import { ConfirmModal } from "@/shared/components/Modal";

expect.extend(toHaveNoViolations);

afterEach(cleanup);

describe("accessible UI primitives", () => {
  it("associates a form input with its label, hint, invalid state and error", async () => {
    const { container, rerender } = render(
      <FormInput id="api-key" label="API key" hint="Stored locally" required />,
    );

    const input = screen.getByRole("textbox", { name: "API key" });
    expect(input.getAttribute("aria-describedby")).toBe("api-key-hint");
    expect(screen.getByText("Stored locally").id).toBe("api-key-hint");
    expect(await axe(container)).toHaveNoViolations();

    rerender(<FormInput id="api-key" label="API key" error="API key is required" required />);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("api-key-error");
    expect(screen.getByRole("alert").textContent).toContain("API key is required");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("uses an alert dialog with named destructive and cancel actions", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { baseElement } = render(
      <ConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete connection?"
        message="This action cannot be undone."
        confirmText="Delete connection"
      />,
    );

    expect(screen.getByRole("alertdialog", { name: "Delete connection?" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete connection" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it("keeps runtime media outside the Next optimizer and rejects executable schemes", () => {
    expect(isSupportedMediaSource("data:image/png;base64,AA==")).toBe(true);
    expect(isSupportedMediaSource("blob:https://example.test/id")).toBe(true);
    expect(isSupportedMediaSource("javascript:alert(1)")).toBe(false);
    expect(isSupportedMediaSource("//untrusted.example/image.png")).toBe(false);

    const { container } = render(<DynamicMedia src="javascript:alert(1)" alt="unsafe" />);
    expect(container.querySelector("img")).toBeNull();
  });
});
