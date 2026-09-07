import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME: string = "modelhub";

/**
 * Where per-user application data lives.
 *
 * The home directory is the right answer on a desktop or a self-hosted box, and
 * the wrong one on a serverless host: on Vercel `os.homedir()` reports a path
 * like /home/sbx_user1051 that does not exist and cannot be created, so any
 * write under it fails with ENOENT. Only the OS temp dir is writable there.
 *
 * Falling back to the temp dir keeps the app able to boot on such a host. It
 * does NOT make the data durable — see the warning in `resolveWritableDir`.
 */
function homeDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function tempDir(): string {
  return path.join(os.tmpdir(), APP_NAME);
}

/** True when the directory exists or could be created. Never throws. */
function isUsable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * First writable candidate, warning loudly when it is the ephemeral one.
 *
 * A caller that lands on the temp dir has no persistence: the SQLite file, the
 * JWT secret and the backups all vanish when the instance is recycled, which on
 * a serverless host is constantly. That is a supported way to *boot*, not a
 * supported way to *run* — the app is local-first and expects a real disk.
 */
function resolveWritableDir(candidates: string[], reason: string): string {
  for (const [index, dir] of candidates.entries()) {
    if (!isUsable(dir)) continue;
    if (index > 0) {
      console.warn(
        `[DATA_DIR] ${reason} → using '${dir}'. This location is not durable: ` +
        `the database, the JWT secret and backups are lost when the instance restarts. ` +
        `Set DATA_DIR to a persistent path (and JWT_SECRET, so sessions survive).`,
      );
    }
    return dir;
  }
  // Nothing was writable. Return the temp path anyway rather than throwing:
  // this module is evaluated inside the Next middleware, so throwing here takes
  // down every request instead of only the features that need the disk.
  console.error(
    `[DATA_DIR] no writable location found (tried ${candidates.join(", ")}). ` +
    `Disk-backed features will fail; set DATA_DIR to a writable path.`,
  );
  return candidates.at(-1) ?? tempDir();
}

function getDataDir(): string {
  const configured: string | undefined = process.env.DATA_DIR;

  if (configured) {
    // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
    // from a Linux-targeted .env or Docker config — they are not valid here.
    if (process.platform === "win32" && /^\//.test(configured)) {
      console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → falling back`);
      return resolveWritableDir([homeDir(), tempDir()], "configured path is a Unix path on Windows");
    }
    return resolveWritableDir(
      [configured, homeDir(), tempDir()],
      `DATA_DIR '${configured}' is not writable`,
    );
  }

  return resolveWritableDir(
    [homeDir(), tempDir()],
    `home directory '${homeDir()}' is not writable`,
  );
}

export const DATA_DIR: string = getDataDir();
