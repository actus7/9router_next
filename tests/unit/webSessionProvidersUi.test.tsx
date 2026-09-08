// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionInstallGuide } from "@/app/(dashboard)/dashboard/web-providers/components/ExtensionInstallGuide";
import BrowserSessionStep from "@/app/(dashboard)/dashboard/providers/[id]/components/web-session/BrowserSessionStep";
import { getPageInfo } from "@/shared/components/getPageInfo";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  buttonVariants: () => "button",
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/i18n/runtime", () => ({ translate: (text: string) => text }));
vi.mock("@/app/(dashboard)/dashboard/providers/[id]/components/web-session/ImportStep", () => ({ default: () => <div>Manual session form</div> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

function detect(requestId: string, providers = ["zai-web"], protocol = 1) {
  act(() => window.dispatchEvent(new MessageEvent("message", { source: window, origin: location.origin, data: {
    channel: "modelhub-web-session-v1", direction: "extension", requestId,
    type: "hello", protocol, version: "1.0.0", providers,
  } })));
}

describe("Web Session provider navigation and setup", () => {
  it("shows install and pairing instructions with a working package URL when missing", () => {
    vi.useFakeTimers();
    render(<ExtensionInstallGuide />);
    act(() => vi.advanceTimersByTime(1801));
    expect(screen.getByRole("link", { name: "Baixar extensão" }).getAttribute("href")).toBe("/extensions/modelhub-web-sessions.zip");
    expect(screen.getByText("Autorize este ModelHub.")).toBeTruthy();
    expect(screen.queryByText("Extensão conectada")).toBeNull();
  });
  it("collapses instructions only after a compatible handshake and allows reopening", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    render(<ExtensionInstallGuide />);
    detect(post.mock.calls[0][0].requestId);
    expect(screen.getByText("Extensão conectada")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Baixar extensão" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Instalação e atualização" }));
    expect(screen.getByRole("link", { name: "Baixar extensão" })).toBeTruthy();
  });
  it("keeps unsupported providers on the explicit manual path", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    render(<BrowserSessionStep provider="muse-spark-web" providerName="Muse Spark" onExtracted={vi.fn()} />);
    detect(post.mock.calls[0][0].requestId);
    expect(screen.getByText("Este provider ainda requer entrada manual.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Conectar Muse Spark" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Opções avançadas: entrada manual" }));
    expect(screen.getByText("Manual session form")).toBeTruthy();
  });
  it("uses the web provider section for the Z.ai breadcrumb", () => {
    expect(getPageInfo("/dashboard/web-providers").title).toBe("Web Session Providers");
    expect(getPageInfo("/dashboard/providers/zai-web").breadcrumbs[0]).toEqual({ label: "Web Session Providers", href: "/dashboard/web-providers" });
    expect(getPageInfo("/dashboard/providers/openai").breadcrumbs[0]?.href).toBe("/dashboard/providers");
  });
});
