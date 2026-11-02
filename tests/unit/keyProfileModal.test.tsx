// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KeyProfileModal from "@/app/(dashboard)/dashboard/endpoint/sections/KeyProfileModal";
import { DEFAULT_ABILITIES, type GatewayProfile } from "@/shared/gateway/gatewayProfile";
import type { UseKeyProfileReturn } from "@/app/(dashboard)/dashboard/endpoint/hooks/useKeyProfile";

const skills = [
  { id: "s1", name: "Reviewer", description: "Reviews code", body: "x".repeat(400) },
  { id: "s2", name: "Writer", description: "Writes docs", body: "y".repeat(40) },
];

vi.mock("swr", () => ({
  default: vi.fn((key: string | null) =>
    key === "/api/harness/skills" ? { data: { skills } } : { data: {} }),
}));

afterEach(cleanup);

function state(overrides: Partial<UseKeyProfileReturn> = {}): UseKeyProfileReturn {
  const profile: GatewayProfile = { abilities: DEFAULT_ABILITIES, skillIds: ["s1"] };
  return { profile, loading: false, saving: false, error: "", save: vi.fn(async () => undefined), ...overrides };
}

describe("KeyProfileModal", () => {
  it("shows the features tab with the guardrail and switches tabs through the callback", () => {
    const onTabChange = vi.fn();
    const s = state();
    render(<KeyProfileModal keyName="ci" tab="features" onTabChange={onTabChange} state={s} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("switch", { name: "Content guardrail" }));
    expect(s.save).toHaveBeenCalledWith({ guardrails: true });

    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(onTabChange).toHaveBeenCalledWith("skills");
  });

  it("adds a skill to the key's profile on the skills tab, keeping the selected ones", () => {
    const s = state();
    render(<KeyProfileModal keyName="ci" tab="skills" onTabChange={vi.fn()} state={s} onClose={vi.fn()} />);

    expect(screen.getByText(/Selected: 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Writer/ }));
    expect(s.save).toHaveBeenCalledWith({ skillIds: ["s1", "s2"] });
  });

  it("renders nothing while no key is picked", () => {
    render(<KeyProfileModal keyName={null} tab="features" onTabChange={vi.fn()} state={state()} onClose={vi.fn()} />);
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
