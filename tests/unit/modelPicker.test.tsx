// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterPickerGroups, sortPickerModels, type PickerGroup } from "@/shared/components/model-picker/modelPickerData";
import ModelPickerShell from "@/shared/components/model-picker/ModelPickerShell";

const groups: PickerGroup[] = [
  { id: "modelhub", name: "ModelHub", models: [{ key: "dev", name: "dev" }, { key: "chat", name: "chat" }] },
  { id: "kilo", name: "Kilo Gateway", models: [{ key: "kilo/zeta", name: "Zeta" }, { key: "kilo/alpha", name: "Alpha" }] },
  { id: "oc", name: "OpenCode", models: [{ key: "oc/big-pickle", name: "Big Pickle" }] },
];

describe("filterPickerGroups", () => {
  it("keeps everything for an empty query", () => {
    expect(filterPickerGroups(groups, "  ")).toEqual(groups);
  });

  it("matches model names and keys, dropping groups left empty", () => {
    const out = filterPickerGroups(groups, "pickle");
    expect(out.map((g) => g.id)).toEqual(["oc"]);
    expect(out[0].models.map((m) => m.key)).toEqual(["oc/big-pickle"]);
  });

  it("a group-name match keeps all of that group's models", () => {
    const out = filterPickerGroups(groups, "kilo");
    expect(out.find((g) => g.id === "kilo")?.models).toHaveLength(2);
  });
});

describe("sortPickerModels", () => {
  const models = groups[1].models;
  it("alpha sorts by name", () => {
    expect(sortPickerModels(models, "alpha", {}).map((m) => m.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("fastest puts tested models first, quickest first", () => {
    const sorted = sortPickerModels(models, "fastest", { "kilo/zeta": { latencyMs: 300, testedAt: "" }, "kilo/alpha": { latencyMs: 900, testedAt: "" } });
    expect(sorted.map((m) => m.name)).toEqual(["Zeta", "Alpha"]);
  });

  it("default keeps the given order", () => {
    expect(sortPickerModels(models, "default", {}).map((m) => m.name)).toEqual(["Zeta", "Alpha"]);
  });
});

function renderShell(props: Partial<React.ComponentProps<typeof ModelPickerShell>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <ModelPickerShell isOpen onClose={onClose} title="Escolher modelo" groups={groups} selectedKeys={[]} onPick={onPick} {...props} />,
  );
  return { onPick, onClose };
}

describe("ModelPickerShell", () => {
  afterEach(cleanup);

  it("shows the provider rail with ModelHub and a count per provider", () => {
    renderShell();
    const rail = screen.getByRole("complementary");
    expect(within(rail).getByText("ModelHub")).toBeTruthy();
    expect(within(rail).getByText("Kilo Gateway")).toBeTruthy();
  });

  it("choosing a provider in the rail narrows the list to its models", () => {
    renderShell();
    fireEvent.click(within(screen.getByRole("complementary")).getByText("OpenCode"));
    expect(screen.getByText("Big Pickle")).toBeTruthy();
    expect(screen.queryByText("Zeta")).toBeNull();
  });

  it("searching filters across providers", () => {
    renderShell();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zeta" } });
    expect(screen.getByText("Zeta")).toBeTruthy();
    expect(screen.queryByText("Big Pickle")).toBeNull();
  });

  it("picking a model reports it with its group", () => {
    const { onPick } = renderShell();
    fireEvent.click(screen.getByText("Big Pickle"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "oc/big-pickle" }), expect.objectContaining({ id: "oc" }));
  });

  it("marks selected keys", () => {
    renderShell({ selectedKeys: ["oc/big-pickle"] });
    expect(screen.getByText("Big Pickle").closest("button")?.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Zeta").closest("button")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the note when given and an empty state when nothing matches", () => {
    renderShell({ note: "Click to add" });
    expect(screen.getByText("Click to add")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzz" } });
    expect(screen.getByText(/no models found/i)).toBeTruthy();
  });
});
