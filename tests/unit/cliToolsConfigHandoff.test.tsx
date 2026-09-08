// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ToolCardShell from "@/app/(dashboard)/dashboard/cli-tools/components/ToolCardShell";
import ManualConfigModal from "@/shared/components/ManualConfigModal";

afterEach(cleanup);

// The endpoint, key and model pickers live in `children`. They are what produce
// the config an operator copies, so hiding them when the CLI was not found on
// the server made the "Get config" output unreachable on every remote deploy —
// `installed` probes the machine running ModelHub, which on Vercel or in Docker
// is never the machine running the CLI.
function renderShell(installed: boolean | undefined) {
  return render(
    <ToolCardShell
      iconSrc="/providers/claude.png"
      toolName="Claude Code"
      configStatus="not_configured"
      isExpanded
      onToggle={() => {}}
      checking={false}
      checkingLabel="Checking..."
      installed={installed}
      notInstalledMessage="Claude Code not detected locally"
      message={null}
      capabilities={{
        manualConfig: { execute: vi.fn() },
        apply: { execute: vi.fn(), disabled: false, loading: false },
        reset: { execute: vi.fn(), disabled: false, loading: false },
      }}
    >
      <label htmlFor="endpoint">Select Endpoint</label>
    </ToolCardShell>,
  );
}

describe("CLI tool card gate", () => {
  it("shows the config form and the copy path, but not Apply, when the CLI is not on the server", () => {
    renderShell(false);

    expect(screen.getByText("Select Endpoint")).toBeTruthy();
    expect(screen.getByRole("button", { name: /get config/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reset$/i })).toBeNull();
  });

  it("offers Apply and Reset when the CLI was found on the machine running ModelHub", () => {
    renderShell(true);

    expect(screen.getByText("Select Endpoint")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /manual config/i })).toBeTruthy();
  });

  it("still renders the form while the status is unknown", () => {
    renderShell(undefined);

    expect(screen.getByText("Select Endpoint")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
  });
});

describe("config handoff modal", () => {
  it("renders a setup command whose payload decodes back to the exact files", () => {
    const configs = [
      { filename: "~/.claude/settings.json", content: '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk_live"}}' },
      { filename: "~/.codex/config.toml", content: 'base_url = "https://hub.example.com/v1"' },
    ];
    render(<ManualConfigModal isOpen onClose={() => {}} title="Claude CLI - Manual Configuration" configs={configs} />);

    const command = screen.getByText(/^npx @model-hub\/setup /).textContent as string;
    const payload = JSON.parse(
      Buffer.from(command.replace("npx @model-hub/setup ", ""), "base64url").toString("utf8"),
    );

    expect(payload.files).toEqual(configs.map((c) => ({ path: c.filename, content: c.content })));
  });

  it("shows no setup command when there is nothing to write", () => {
    render(<ManualConfigModal isOpen onClose={() => {}} configs={[]} />);
    expect(screen.queryByText(/^npx @model-hub\/setup /)).toBeNull();
  });
});
