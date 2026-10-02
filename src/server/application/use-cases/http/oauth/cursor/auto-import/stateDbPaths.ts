import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Full path to Cursor's `state.vscdb` as seen from the server's filesystem. */
export const CURSOR_STATE_DB_ENV = "CURSOR_STATE_DB";

// Windows ships profiles that never hold a per-user Cursor install: `Public`,
// `Default`/`Default User` (templates for new profiles) and `All Users` (a
// junction, not a profile). Scanning them only adds noise to the not-found
// error listing.
const NON_USER_WINDOWS_PROFILES = new Set([
  "Public",
  "Default",
  "Default User",
  "All Users",
]);

/**
 * Windows-side `state.vscdb` candidates for each Windows profile visible from
 * WSL at /mnt/c/Users. The paths are literal "/" strings on purpose: they only
 * mean anything on the Linux side of a WSL mount, and `path.join` would emit
 * "\" separators when this module is imported on a Windows host (the unit
 * suite runs there).
 */
export function buildWslCandidatePaths(windowsUsers: readonly string[]): string[] {
  return windowsUsers
    .filter((user) => user.length > 0 && !NON_USER_WINDOWS_PROFILES.has(user))
    .flatMap((user) => [
      `/mnt/c/Users/${user}/AppData/Roaming/Cursor/User/globalStorage/state.vscdb`,
      `/mnt/c/Users/${user}/AppData/Roaming/Cursor - Insiders/User/globalStorage/state.vscdb`,
      `/mnt/c/Users/${user}/AppData/Local/Cursor/User/globalStorage/state.vscdb`,
      `/mnt/c/Users/${user}/AppData/Local/Programs/Cursor/User/globalStorage/state.vscdb`,
    ]);
}

/**
 * WSL leaves three fingerprints, any one of which is enough: the distro env
 * var, a "/proc/version" that names the Microsoft kernel, or the Interop
 * binfmt registration. Probing all three keeps detection working even when a
 * shell dropped the env var (services, `sudo`) or /proc is partially hidden.
 */
export function isWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    if (readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft")) {
      return true;
    }
  } catch {
    // No /proc at all (macOS, native Windows) — not WSL by any marker.
  }
  return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}

/** Profile directory names under /mnt/c/Users, or [] when C: is not visible. */
function listWindowsProfiles(): string[] {
  try {
    return readdirSync("/mnt/c/Users", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // WSL without a /mnt/c mount (or a Docker container on the WSL kernel that
    // never mounted the Windows drive) — nothing to scan.
    return [];
  }
}

/** The per-platform guesses, in the order they have always been tried. */
function platformDefaultPaths(platform: string): string[] {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(
        home,
        "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
      ),
      join(
        home,
        "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
      ),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        appData,
        "Cursor - Insiders",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        localAppData,
        "Programs",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

/**
 * Environment facts that steer candidate selection. Injectable so the unit
 * suite can exercise WSL/override behavior on any host without /mnt/c.
 */
export type CandidateScan = {
  /** Value of CURSOR_STATE_DB, if any. */
  override?: string | undefined;
  /** True when Windows drives are reachable under /mnt/c. */
  wsl?: boolean;
  /** Windows profile directory names under /mnt/c/Users. */
  windowsUsers?: readonly string[];
};

function resolveScan(): CandidateScan {
  const wsl = isWsl();
  return {
    override: process.env[CURSOR_STATE_DB_ENV],
    wsl,
    windowsUsers: wsl ? listWindowsProfiles() : [],
  };
}

/**
 * Get candidate db paths by platform, most specific first.
 *
 * Order matters — the caller picks the first readable file. On WSL the
 * Windows-side databases come before the native `~/.config` guesses because
 * the Cursor people actually run there is the Windows one; a `~/.config/Cursor`
 * left behind by a native-Linux install attempt is the weaker signal.
 */
export function getCandidatePaths(platform: string, scan?: CandidateScan): string[] {
  const resolved = scan ?? resolveScan();
  const candidates: string[] = [];

  // 1. Explicit override wins over every guess. In Docker the container sees
  //    nothing of the host disk, so the operator bind-mounts the Cursor
  //    globalStorage directory and points CURSOR_STATE_DB at the container
  //    path. If it is set but not readable the loop falls through to the
  //    guesses below — a bad override must not disable discovery entirely.
  const override = resolved.override?.trim();
  if (override) candidates.push(override);

  // 2. WSL: the Windows Cursor installs under /mnt/c/Users/<profile>.
  if (resolved.wsl) {
    candidates.push(...buildWslCandidatePaths(resolved.windowsUsers ?? []));
  }

  // 3. The standard per-platform locations.
  candidates.push(...platformDefaultPaths(platform));
  return candidates;
}
