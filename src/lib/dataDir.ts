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
 * A caller that lands on the temp dir has no persistence. Since the Neon
 * migration that no longer means data loss — the database, the provider
 * credentials and the sessions are in Postgres and behind Neon Auth. What it
 * does mean is that every host-local feature backed by a file resets when the
 * instance recycles: the Cloudflare/Tailscale tunnel state and binaries,
 * pxpipe's install and headroom's process files.
 */
function resolveWritableDir(candidates: string[], reason: string): string {
  for (const [index, dir] of candidates.entries()) {
    if (!isUsable(dir)) continue;
    if (index > 0) {
      console.warn(
        `[DATA_DIR] ${reason} → using '${dir}'. This location is not durable: ` +
        `the tunnel, pxpipe and headroom lose their on-disk state when the instance restarts. ` +
        `The database and stored credentials are unaffected — they live in Neon Postgres. ` +
        `Set DATA_DIR to a persistent path to use the host-local features.`,
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

/**
 * True when the resolved directory does not survive a restart.
 *
 * It no longer means data loss: the database, the provider credentials and the
 * sessions moved to Neon Postgres and Neon Auth. What resets on every recycle
 * is the host-local, file-backed state — the Cloudflare/Tailscale tunnel,
 * pxpipe's install, headroom's process files and the machine id. Those fail
 * quietly, which is why the condition is exported and surfaced in the UI rather
 * than left in a boot-time log nobody reads.
 *
 * An explicitly configured DATA_DIR under the temp dir counts as ephemeral too,
 * because it is: the flag describes the storage, not how it was chosen.
 */
export const DATA_DIR_IS_EPHEMERAL: boolean = DATA_DIR === tempDir();
