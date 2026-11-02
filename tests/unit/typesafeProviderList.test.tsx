// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProvidersClient from "@/app/(dashboard)/dashboard/providers/ProvidersClient";
import { useHeaderSearchStore } from "@/store/headerSearchStore";

vi.mock("@/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge", () => ({
  default: () => null,
}));

afterEach(cleanup);

const renderProviders = (hasTypesafeKey: boolean | null) => render(
  <ProvidersClient initialConnections={[]} initialNodes={[]} hasTypesafeKey={hasTypesafeKey} />,
);
const selectSystemOne = () => fireEvent.click(screen.getByRole("button", { name: "System One" }));
const typesafeCard = () => screen.getByRole("link", { name: /TypeSafe \(Jev\)/ });

describe("TypeSafe on the providers page", () => {
  it("lists direct Jev alongside the gateway and opens the existing decision engine", () => {
    renderProviders(true);
    selectSystemOne();

    const card = typesafeCard();
    expect(card.getAttribute("href")).toBe("/dashboard/profile#decision-engine");
    expect(within(card).getByText("Connected")).toBeTruthy();
    expect(within(card).queryByRole("switch")).toBeNull();
    expect(screen.getByRole("link", { name: /Vercel AI Gateway/ })).toBeTruthy();
  });

  it("counts the saved TypeSafe key in Connected without a provider connection row", () => {
    renderProviders(true);
    selectSystemOne();
    fireEvent.click(screen.getByRole("button", { name: "Connected" }));
    expect(typesafeCard()).toBeTruthy();
    expect(screen.queryByText("No providers match your search")).toBeNull();
  });

  it("shows an unconfigured key and removes it from Connected and Free", () => {
    renderProviders(false);
    selectSystemOne();
    expect(within(typesafeCard()).getByText("No connections")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connected" }));
    expect(screen.queryByRole("link", { name: /TypeSafe \(Jev\)/ })).toBeNull();
    expect(screen.getByText("No providers match your search")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Free available" }));
    expect(screen.queryByRole("link", { name: /TypeSafe \(Jev\)/ })).toBeNull();
  });

  it("matches Jev searches and only the System One kind", () => {
    renderProviders(true);
    act(() => useHeaderSearchStore.getState().setQuery("jev"));
    expect(typesafeCard()).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.queryByRole("link", { name: /TypeSafe \(Jev\)/ })).toBeNull();
  });

  it("updates the card when returning from the key settings", () => {
    const view = renderProviders(true);
    selectSystemOne();
    expect(within(typesafeCard()).getByText("Connected")).toBeTruthy();

    view.rerender(<ProvidersClient initialConnections={[]} initialNodes={[]} hasTypesafeKey={false} />);
    expect(within(typesafeCard()).getByText("No connections")).toBeTruthy();
  });

  it("does not report a missing key when checking its status failed", () => {
    renderProviders(null);
    selectSystemOne();
    const card = typesafeCard();
    expect(within(card).getByText("Could not check the Jev key.")).toBeTruthy();
    expect(within(card).queryByText("No connections")).toBeNull();
    expect(within(card).queryByText("Connected")).toBeNull();
  });
});
