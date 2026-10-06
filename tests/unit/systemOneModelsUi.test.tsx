// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useSystemOneModels = vi.fn();
vi.mock("@/shared/hooks/useSystemOneModels", () => ({ useSystemOneModels: () => useSystemOneModels() }));

import { SystemOneModelsTab } from "@/app/(dashboard)/dashboard/combos/SystemOneModelsTab";
import { SystemOneJudgePicker } from "@/app/(dashboard)/dashboard/combos/SystemOneJudgePicker";

const JEV = { id: "typesafe-ai/jev", name: "Jev", description: "Typed decisions" };
const LAYA = { id: "typesafe-ai/laya", name: "Laya", description: null };

function loaded(models = [JEV, LAYA], extra: Record<string, unknown> = {}) {
  useSystemOneModels.mockReturnValue({ data: { models, source: "gateway", ...extra }, isLoading: false, error: undefined });
}

afterEach(() => { cleanup(); useSystemOneModels.mockReset(); });

describe("SystemOneModelsTab", () => {
  it("lists each model with its id", () => {
    loaded();
    render(<SystemOneModelsTab comboStrategies={{}} />);
    expect(screen.getByText("Jev")).toBeTruthy();
    expect(screen.getByText("typesafe-ai/laya")).toBeTruthy();
  });

  it("says which fusion combos use the model as judge", () => {
    loaded();
    render(<SystemOneModelsTab comboStrategies={{ dev: { fallbackStrategy: "fusion", judgeModel: "typesafe-ai/jev" }, other: { fallbackStrategy: "fusion", judgeModel: "oc/x" } }} />);
    const jev = screen.getByText("Jev").closest("li") as HTMLElement;
    expect(within(jev).getByText("dev")).toBeTruthy();
    expect(within(jev).queryByText("other")).toBeNull();
  });

  it("explains a missing gateway key instead of an empty page", () => {
    loaded([JEV], { source: "builtin", error: "no_key" });
    render(<SystemOneModelsTab comboStrategies={{}} />);
    expect(screen.getByRole("status").textContent).toMatch(/vercel ai gateway/i);
  });
});

describe("SystemOneJudgePicker", () => {
  it("picking a model reports its id and closes", () => {
    loaded();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<SystemOneJudgePicker isOpen onClose={onClose} onSelect={onSelect} selected="" />);
    fireEvent.click(screen.getByRole("button", { name: /laya/i }));
    expect(onSelect).toHaveBeenCalledWith("typesafe-ai/laya");
    expect(onClose).toHaveBeenCalled();
  });

  it("states that a System One judge picks, it does not write", () => {
    loaded();
    render(<SystemOneJudgePicker isOpen onClose={vi.fn()} onSelect={vi.fn()} selected="" />);
    expect(screen.getByRole("dialog").textContent).toMatch(/picks the best/i);
  });
});
