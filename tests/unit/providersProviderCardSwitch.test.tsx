// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderCard } from "@/app/(dashboard)/dashboard/providers/components/ProviderCard";
import type { ProviderInfo, ProviderStats } from "@/app/(dashboard)/dashboard/providers/types";

const provider = { id: "openai", name: "OpenAI", color: "#10a37f", textIcon: "OA" } as unknown as ProviderInfo;
const stats = {
  connected: 1, error: 0, errorCode: null, errorTime: null, allDisabled: false, total: 1,
} as unknown as ProviderStats;

describe("ProviderCard enable switch", () => {
  afterEach(() => cleanup());

  it("keeps the switch out of the navigation link so it is not nested interactive content", () => {
    const { container } = render(
      <ProviderCard providerId="openai" provider={provider} stats={stats} onToggle={vi.fn()} />,
    );
    const link = container.querySelector("a");
    const toggle = screen.getByTitle("Disable provider");

    expect(link).not.toBeNull();
    expect(link!.contains(toggle)).toBe(false);
  });

  it("toggles the provider without navigating when the switch is clicked", () => {
    const onToggle = vi.fn();
    render(<ProviderCard providerId="openai" provider={provider} stats={stats} onToggle={onToggle} />);

    fireEvent.click(screen.getByTitle("Disable provider"));

    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
