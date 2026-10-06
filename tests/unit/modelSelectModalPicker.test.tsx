// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const data = {
  filteredCombos: [{ id: "c1", name: "dev" }],
  filteredGroups: {
    oc: { name: "OpenCode", alias: "oc", color: "", models: [{ id: "big", name: "Big Pickle", value: "oc/big-pickle", isCustom: true }] },
    kilo: { name: "Kilo", alias: "kilo", color: "", models: [{ id: "k", name: "Kilo Auto", value: "kilo/auto" }] },
  },
  getCaps: () => null,
};
vi.mock("@/shared/components/useModelSelectData", () => ({ useModelSelectData: () => data }));
const useSystemOneModels = vi.fn();
vi.mock("@/shared/hooks/useSystemOneModels", () => ({ useSystemOneModels: (enabled?: boolean) => useSystemOneModels(enabled) }));
useSystemOneModels.mockReturnValue({ data: { models: [{ id: "typesafe-ai/jev", name: "Jev", description: null }], source: "gateway" } });

import ModelSelectModal from "@/shared/components/ModelSelectModal";

function renderModal(props: Partial<React.ComponentProps<typeof ModelSelectModal>> = {}) {
  const onSelect = vi.fn();
  const onDeselect = vi.fn();
  const onClose = vi.fn();
  render(<ModelSelectModal isOpen onClose={onClose} onSelect={onSelect} onDeselect={onDeselect} title="Selecionar modelo do desempate" {...props} />);
  return { onSelect, onDeselect, onClose };
}

describe("ModelSelectModal on the shared picker", () => {
  afterEach(cleanup);

  it("lists combos under ModelHub, then the providers", () => {
    renderModal();
    expect(screen.getAllByText("ModelHub").length).toBeGreaterThan(0);
    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.getByText("Big Pickle")).toBeTruthy();
    expect(screen.getByText("Custom")).toBeTruthy();
  });

  it("a pick reports the model record and closes by default", () => {
    const { onSelect, onClose } = renderModal();
    fireEvent.click(screen.getByText("Big Pickle"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: "oc/big-pickle", isCustom: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it("picking a combo reports its name as the value", () => {
    const { onSelect } = renderModal();
    fireEvent.click(screen.getByText("dev"));
    expect(onSelect).toHaveBeenCalledWith({ value: "dev" });
  });

  it("multi-select: stays open, adds and removes, and explains it", () => {
    const { onSelect, onDeselect, onClose } = renderModal({ closeOnSelect: false, addedModelValues: ["kilo/auto"] });
    expect(screen.getByText(/click to add, click again to remove/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Big Pickle"));
    expect(onSelect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Kilo Auto"));
    expect(onDeselect).toHaveBeenCalledWith(expect.objectContaining({ value: "kilo/auto" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("single choice shows no add/remove hint", () => {
    renderModal();
    expect(screen.queryByText(/click to add/i)).toBeNull();
  });

  it("lists System One models only when asked, and reports the pick by id", () => {
    renderModal();
    expect(screen.queryByText("Jev")).toBeNull();
    cleanup();
    const { onSelect } = renderModal({ includeSystemOne: true, systemOneNote: "Picks the best answer" });
    expect(screen.getByText("Picks the best answer")).toBeTruthy();
    fireEvent.click(screen.getByText("Jev"));
    expect(onSelect).toHaveBeenCalledWith({ value: "typesafe-ai/jev" });
  });

  it("does not fetch System One models unless they were asked for", () => {
    useSystemOneModels.mockClear();
    renderModal();
    expect(useSystemOneModels).toHaveBeenLastCalledWith(false);
  });
});
