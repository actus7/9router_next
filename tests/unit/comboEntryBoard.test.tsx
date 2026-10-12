// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ComplexityRoutingBoard from "@/app/(dashboard)/dashboard/combos/[id]/ComplexityRoutingBoard";

const INFO = {
  spec: {
    id: "openai/gpt-5.6-terra",
    params: [
      { path: "reasoning_effort", label: "Reasoning effort", type: "enum", group: "reasoning", default: "medium", values: ["low", "medium", "high"] },
      { path: "max_tokens", label: "Max tokens", type: "integer", group: "generation_length", default: 4096, range: { min: 1, max: 100000 } },
    ],
  },
  connections: [{ id: "c1", label: "chat" }, { id: "c2", label: "rob" }],
};

beforeAll(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function flush() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }

async function mount(onChange: (...args: unknown[]) => void, entries: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(INFO))));
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(
      <ComplexityRoutingBoard
        overrides={{ standard: ["codex/gpt-5.6-terra"] }}
        entries={entries}
        onOverridesChange={onChange as never}
        enabled
        profiles={[]}
        activeProviders={[]}
        modelAliases={{}}
        onSuggest={() => {}}
        suggesting={false}
        onSyncAa={() => {}}
        syncingAa={false}
      />,
    );
  });
  await flush();
  return host;
}

describe("lane entry controls", () => {
  it("offers an account select when the provider has several, and reports the choice index-aligned", async () => {
    const onChange = vi.fn();
    const host = await mount(onChange);
    const select = host.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect([...select.options].map((o) => o.textContent)).toEqual(["Auto", "chat", "rob"]);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "c2");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("standard", ["codex/gpt-5.6-terra"], [{ connectionId: "c2" }]);
  });

  it("duplicates the entry onto another account right below it", async () => {
    const onChange = vi.fn();
    const host = await mount(onChange, { standard: [{ connectionId: "c1" }] });
    const dup = host.querySelector('button[aria-label="Add fallback"]') as HTMLButtonElement;
    await act(async () => { dup.click(); });
    expect(onChange).toHaveBeenCalledWith(
      "standard",
      ["codex/gpt-5.6-terra", "codex/gpt-5.6-terra"],
      [{ connectionId: "c1" }, { connectionId: "c2" }],
    );
  });

  it("opens the parameters dialog from the catalog and saves only what was set", async () => {
    const onChange = vi.fn();
    const host = await mount(onChange);
    const open = host.querySelector('button[aria-label^="Model parameters"]') as HTMLButtonElement;
    await act(async () => { open.click(); });
    const dialog = document.body;
    expect(dialog.textContent).toContain("Reasoning effort");
    expect(dialog.textContent).toContain("Max tokens");
    const effort = [...dialog.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "high")) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(effort, "high");
      effort.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Save") as HTMLButtonElement;
    await act(async () => { save.click(); });
    expect(onChange).toHaveBeenCalledWith("standard", ["codex/gpt-5.6-terra"], [{ params: { reasoning_effort: "high" } }]);
  });
});
