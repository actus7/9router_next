// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useSystemOneModels = vi.fn();
vi.mock("@/shared/hooks/useSystemOneModels", () => ({ useSystemOneModels: () => useSystemOneModels() }));

import { SystemOneModelsTab } from "@/app/(dashboard)/dashboard/combos/SystemOneModelsTab";

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
