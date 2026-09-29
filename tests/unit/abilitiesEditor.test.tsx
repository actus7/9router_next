// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AbilitiesEditor from "@/shared/components/gateway/AbilitiesEditor";
import { DEFAULT_ABILITIES, type GatewayAbilities } from "@/shared/gateway/gatewayProfile";

vi.mock("swr", () => ({ default: vi.fn(() => ({ data: { cavemanEnabled: true } })) }));

afterEach(cleanup);

describe("AbilitiesEditor", () => {
  it("toggles an ability without touching the others", () => {
    const onChange = vi.fn();
    render(<AbilitiesEditor value={DEFAULT_ABILITIES} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: /compress llm output/i }));
    const next: GatewayAbilities = onChange.mock.calls[0]![0];
    expect(next.caveman).toEqual({ enabled: true, level: "full" });
    expect(next.rtk).toBe(DEFAULT_ABILITIES.rtk);
  });

  it("shows level choices only for an enabled ability and changes the level", () => {
    const onChange = vi.fn();
    const value = { ...DEFAULT_ABILITIES, ponytail: { enabled: true, level: "full" } };
    render(<AbilitiesEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Ultra" }));
    expect(onChange.mock.calls[0]![0].ponytail).toEqual({ enabled: true, level: "ultra" });
  });

  it("offers Synapse learning only while Synapse is on", () => {
    const { rerender } = render(<AbilitiesEditor value={DEFAULT_ABILITIES} onChange={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: /learn answers/i })).toBeNull();
    const onChange = vi.fn();
    rerender(
      <AbilitiesEditor value={{ ...DEFAULT_ABILITIES, synapse: { enabled: true, level: "lite", learning: false } }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /learn answers/i }));
    expect(onChange.mock.calls[0]![0].synapse.learning).toBe(true);
  });
});

describe("ChatAbilitiesPanel", () => {
  it("shows the account default until the chat customizes, then saves into pluginSettings", async () => {
    const { default: ChatAbilitiesPanel } = await import(
      "@/app/(dashboard)/dashboard/basic-chat/sections/ChatAbilitiesPanel"
    );
    const onUpdate = vi.fn();
    const session = { id: "s1", pluginSettings: {} } as never;
    render(<ChatAbilitiesPanel session={session} onUpdate={onUpdate} />);
    expect(screen.getByText(/padrão da conta/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /economizador de tokens/i }));
    // Account default has Caveman on (mocked /api/settings).
    const caveman = screen.getByRole("switch", { name: /compress llm output/i });
    expect(caveman.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(caveman);
    expect(onUpdate).toHaveBeenCalledWith({ abilities: expect.objectContaining({ caveman: { enabled: false, level: "full" } }) });
  });
});
