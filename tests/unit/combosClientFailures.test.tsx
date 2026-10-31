// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifyError = vi.hoisted(() => vi.fn());

vi.mock("@/store/notificationStore", () => ({ notify: { error: notifyError, success: vi.fn() } }));
vi.mock("@/i18n/runtime", () => ({ translate: (text: string) => text }));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => undefined }) }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy: vi.fn() }) }));
vi.mock("@/shared/components/Modal", () => ({ ConfirmModal: () => null }));
vi.mock("@/shared/components/InfoButton", () => ({ InfoButton: () => null }));
vi.mock("@/app/(dashboard)/dashboard/combos/SystemOneModelsTab", () => ({ SystemOneModelsTab: () => null }));
vi.mock("@/app/(dashboard)/dashboard/combos/ModelHealthPanel", () => ({ ModelHealthPanel: () => null }));
vi.mock("@/app/(dashboard)/dashboard/combos/CapacityAdapterSection", () => ({ CapacityAdapterSection: () => null }));
vi.mock("@/app/(dashboard)/dashboard/combos/ComboCard", () => ({ ComboCard: () => null }));
// next/dynamic would lazy-load the real form; a stub that saves on click is enough to drive handleCreate.
vi.mock("next/dynamic", () => ({
  default: () => function FakeComboForm({ onSave }: { onSave: (data: { name: string; models: string[] }) => void }) {
    return <button type="button" onClick={() => onSave({ name: "fast", models: [] })}>save-form</button>;
  },
}));

import CombosClient from "@/app/(dashboard)/dashboard/combos/CombosClient";
import type { CombosClientProps } from "@/app/(dashboard)/dashboard/combos/combo-types";

const PROPS = {
  initialCombos: [],
  initialProviders: [],
  initialSettings: { comboStrategies: {}, capacityAdapter: {} },
  initialAliases: {},
} as unknown as CombosClientProps;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  notifyError.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CombosClient create failures", () => {
  it("tells the user when creating a combo fails at the network level", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    render(<CombosClient {...PROPS} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Create Combo" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "save-form" }));

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Failed to create combo"));
  });
});
