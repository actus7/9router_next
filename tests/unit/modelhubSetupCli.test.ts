import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildSetupCommand } from "@/shared/utils/setupCommand";

const CLI = join(process.cwd(), "packages", "modelhub-setup", "index.mjs");

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function run(payload: unknown, home: string, extraArgs: string[] = []) {
  return execFileSync(process.execPath, [CLI, encode(payload), ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "modelhub-setup-"));
}

describe("@model-hub/setup", () => {
  it("creates a config file that does not exist yet", () => {
    const home = freshHome();
    run({ tool: "claude", files: [{ path: "~/.claude/settings.json", content: '{"env":{"ANTHROPIC_BASE_URL":"https://hub/v1"}}' }] }, home);

    const written = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(written.env.ANTHROPIC_BASE_URL).toBe("https://hub/v1");
  });

  it("merges into an existing JSON config instead of clobbering it", () => {
    const home = freshHome();
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash"] }, env: { EXISTING: "keep" } }),
    );

    run({ tool: "claude", files: [{ path: "~/.claude/settings.json", content: '{"env":{"ANTHROPIC_BASE_URL":"https://hub/v1"}}' }] }, home);

    const written = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(written.permissions.allow).toEqual(["Bash"]);
    expect(written.env.EXISTING).toBe("keep");
    expect(written.env.ANTHROPIC_BASE_URL).toBe("https://hub/v1");
    expect(readdirSync(join(home, ".claude")).some((f) => f.includes(".modelhub-bak-"))).toBe(true);
  });

  it("refuses to write outside the home directory", () => {
    const home = freshHome();
    expect(() => run({ files: [{ path: "/etc/passwd", content: "x" }] }, home)).toThrow(/refusing to write outside/);
  });

  it("skips a path that still contains a placeholder", () => {
    const home = freshHome();
    const output = run({ files: [{ path: "~/.config/<appliedId>.json", content: "{}" }] }, home);
    expect(output).toMatch(/skipped/);
  });

  it("applies the command the dashboard actually renders, non-ASCII included", () => {
    const home = freshHome();
    const content = '{"note":"acentuação — ok"}';
    const command = buildSetupCommand([{ filename: "~/.claude/settings.json", content }]);
    const token = command.split(" ").pop() as string;

    execFileSync(process.execPath, [CLI, token], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).note).toBe("acentuação — ok");
  });

  // Windows has no POSIX mode bits; the ACL governs there and statSync reports a
  // synthetic 0666/0444.
  it.skipIf(process.platform === "win32")("keeps the config and its backup readable only by the owner", () => {
    const home = freshHome();
    const settings = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settings, JSON.stringify({ env: {} }), { mode: 0o644 });

    run({ files: [{ path: "~/.claude/settings.json", content: '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk_secret"}}' }] }, home);

    expect(statSync(settings).mode & 0o777).toBe(0o600);
    const backup = readdirSync(join(home, ".claude")).find((f) => f.includes(".modelhub-bak-")) as string;
    expect(statSync(join(home, ".claude", backup)).mode & 0o777).toBe(0o600);
  });

  it("writes nothing with --dry-run", () => {
    const home = freshHome();
    const output = run({ files: [{ path: "~/.codex/config.toml", content: "base_url = \"https://hub/v1\"" }] }, home, ["--dry-run"]);
    expect(output).toMatch(/would be created/);
    expect(readdirSync(home)).toEqual([]);
  });
});
