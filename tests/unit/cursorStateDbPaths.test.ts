import { describe, expect, it } from "vitest";
import {
  buildWslCandidatePaths,
  getCandidatePaths,
} from "@/server/application/use-cases/http/oauth/cursor/auto-import/stateDbPaths";

/**
 * Candidate selection for the Cursor `state.vscdb` auto-import.
 *
 * The endpoint runs in three very different places: native Windows/macOS, WSL
 * (where the live database is the *Windows* Cursor under /mnt/c/Users) and a
 * Docker container that sees none of the host disk unless an operator
 * bind-mounts the directory and names it via CURSOR_STATE_DB. The properties
 * asserted here are the ones each scenario depends on: the override is tried
 * first, WSL profiles are scanned minus the non-user ones, and the classic
 * per-platform guesses survive untouched for everyone else.
 *
 * `path.join` binds to the host platform, so the expectations built with it
 * carry "\" separators on Windows. Every comparison goes through `norm` and
 * asserts the logic, not the runner's separators.
 */
function norm(value: string): string {
  return value.replaceAll("\\", "/");
}

describe("cursor state.vscdb candidate paths", () => {
  it("tries CURSOR_STATE_DB before every guess", () => {
    for (const platform of ["linux", "win32", "darwin"]) {
      const candidates = getCandidatePaths(platform, {
        override: "/cursor-global-storage/state.vscdb",
        wsl: true,
        windowsUsers: ["alexs"],
      });
      expect(norm(candidates[0])).toBe("/cursor-global-storage/state.vscdb");
    }
  });

  it("ignores an empty override instead of probing the current directory", () => {
    const candidates = getCandidatePaths("linux", {
      override: "   ",
      wsl: false,
      windowsUsers: [],
    });
    expect(candidates).toHaveLength(2);
  });

  it("scans every Windows profile under /mnt/c/Users, skipping the non-user ones", () => {
    // Public/Default/Default User/All Users are templates or junctions, never a
    // per-user Cursor install.
    const paths = buildWslCandidatePaths([
      "alexs",
      "Public",
      "Default",
      "Default User",
      "All Users",
      "second",
    ]);

    expect(paths).toEqual([
      "/mnt/c/Users/alexs/AppData/Roaming/Cursor/User/globalStorage/state.vscdb",
      "/mnt/c/Users/alexs/AppData/Roaming/Cursor - Insiders/User/globalStorage/state.vscdb",
      "/mnt/c/Users/alexs/AppData/Local/Cursor/User/globalStorage/state.vscdb",
      "/mnt/c/Users/alexs/AppData/Local/Programs/Cursor/User/globalStorage/state.vscdb",
      "/mnt/c/Users/second/AppData/Roaming/Cursor/User/globalStorage/state.vscdb",
      "/mnt/c/Users/second/AppData/Roaming/Cursor - Insiders/User/globalStorage/state.vscdb",
      "/mnt/c/Users/second/AppData/Local/Cursor/User/globalStorage/state.vscdb",
      "/mnt/c/Users/second/AppData/Local/Programs/Cursor/User/globalStorage/state.vscdb",
    ]);
  });

  it("on WSL, prefers the Windows databases over the native ~/.config guesses", () => {
    const candidates = getCandidatePaths("linux", {
      wsl: true,
      windowsUsers: ["alexs"],
    }).map(norm);

    const windowsDb = "/mnt/c/Users/alexs/AppData/Roaming/Cursor/User/globalStorage/state.vscdb";
    const nativeGuess = candidates.findIndex((path) => path.includes(".config"));
    expect(candidates.indexOf(windowsDb)).toBeGreaterThanOrEqual(0);
    expect(nativeGuess).toBeGreaterThan(candidates.indexOf(windowsDb));
  });

  it("keeps the classic linux guesses when not on WSL", () => {
    const candidates = getCandidatePaths("linux", { wsl: false }).map(norm);
    expect(candidates).toEqual([
      expect.stringContaining(".config/Cursor/User/globalStorage/state.vscdb"),
      expect.stringContaining(".config/cursor/User/globalStorage/state.vscdb"),
    ]);
  });

  it("keeps the four win32 guesses (Roaming first) untouched", () => {
    const candidates = getCandidatePaths("win32", { wsl: false }).map(norm);
    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toContain("Roaming/Cursor/User/globalStorage/state.vscdb");
    expect(candidates[1]).toContain("Cursor - Insiders");
    expect(candidates[2]).toContain("Local/Cursor/User/globalStorage/state.vscdb");
    expect(candidates[3]).toContain("Programs/Cursor");
  });
});
