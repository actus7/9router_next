import { execFileSync, execSync } from "child_process";
import path from "path";

// Extras that improve headroom compression quality. `proxy` is the base;
// `code` adds tree-sitter AST compression; `ml` adds Kompress-v2 HF model.
export const HEADROOM_COMPRESSION_EXTRAS: string[] = ["code", "ml"];

// Marker packages that each extra pulls in. Detected from `pip list --format=json`
// so one call can answer both the installed version and active extras.
export const EXTRA_MARKERS: Record<string, string[]> = {
  code: ["tree-sitter", "tree-sitter-language-pack"],
  ml: ["torch", "huggingface-hub"],
};

const HEADROOM_PIP_TIMEOUT_MS: number = 8000;

const IS_WIN: boolean = process.platform === "win32";
const WHICH_CMD: string = IS_WIN ? "where" : "which";

// Extra bin dirs often missing from a packaged/launchd PATH (Python installs headroom here).
const EXTRA_BINS: string[] = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH: string = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const PYTHON_CANDIDATES: string[] = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION: [number, number] = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS: number = 1500;
const LOOPBACK_HOSTS: Set<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL: string = process.env.HEADROOM_URL || "http://localhost:8787";

interface HeadroomStatus {
  installed: boolean;
  path: string | null;
  running: boolean;
  python: string | null;
  localUrl: boolean;
  canStart: boolean;
  version: string | null;
  extras: Record<string, boolean>;
}

interface ExtrasStatus {
  installed: boolean;
  version: string | null;
  extras: Record<string, boolean>;
}

// Detect whether the headroom CLI is installed and where its binary lives.
export function findHeadroomBinary(): string | null {
  try {
    const out: string = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    // Windows `where` may return multiple lines — take the first.
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

function pythonCandidates(): string[] {
  const list: string[] = [];
  const bin: string | null = findHeadroomBinary();
  if (bin) {
    const dir: string = path.dirname(bin);
    const names: string[] = IS_WIN ? ["python.exe", "python3.exe"] : ["python3", "python3.13", "python"];
    for (const n of names) list.push(path.join(dir, n));
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES) list.push(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  list.push(...PYTHON_CANDIDATES);
  return list;
}

export function findPython310(): string | null {
  let fallback: string | null = null;
  for (const candidate of pythonCandidates()) {
    try {
      const ver: string = execSync(`${candidate} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      }).toString().trim();
      const match: RegExpMatchArray | null = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor]: number[] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) continue;
      if (!fallback) fallback = candidate;
      try {
        execFileSync(candidate, ["-m", "pip", "show", "headroom-ai"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: HEADROOM_PIP_TIMEOUT_MS,
          env: { ...process.env, PATH: EXTENDED_PATH },
        });
        return candidate;
      } catch {
        // Keep scanning until an interpreter that sees headroom-ai is found.
      }
    } catch {
      // candidate not present, try next
    }
  }
  return fallback;
}

// Probe whether a Headroom proxy is reachable at the given URL by hitting /health.
async function probeProxyRunning(url: string): Promise<boolean> {
  if (!url) return false;
  const base: string = String(url).replace(/\/$/, "");
  try {
    const res: Response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url: string): boolean {
  try {
    const parsed: URL = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Aggregate status for the dashboard: installed, running, python interpreter.
export async function getHeadroomStatus(url: string): Promise<HeadroomStatus> {
  const headroomPath: string | null = findHeadroomBinary();
  const python: string | null = findPython310();
  const installed: boolean = Boolean(headroomPath);
  const running: boolean = await probeProxyRunning(url);
  const localUrl: boolean = isLoopbackHeadroomUrl(url);
  const extrasStatus: ExtrasStatus = installed ? getInstalledHeadroomExtras(python) : { installed: false, version: null, extras: { code: false, ml: false } };
  return {
    installed,
    path: headroomPath,
    running,
    python,
    localUrl,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
  };
}

// Parse installed headroom-ai version + which compression extras are
// actually installed (detected via marker package presence). One `pip list`
// call is enough to answer both questions.
export function getInstalledHeadroomExtras(python?: string | null): ExtrasStatus {
  const py: string | null = python || findPython310();
  if (!py) return { installed: false, version: null, extras: { code: false, ml: false } };
  try {
    const out: string = execFileSync(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: HEADROOM_PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString();
    const packages: Array<{ name: string; version: string }> = JSON.parse(out);
    const names: Set<string> = new Set(packages.map((p: { name: string }) => String(p.name || "").toLowerCase()));
    const installed: boolean = names.has("headroom-ai");
    if (!installed) return { installed: false, version: null, extras: { code: false, ml: false } };
    const version: string | null = packages.find((p: { name: string }) => p.name?.toLowerCase() === "headroom-ai")?.version || null;
    const extras: Record<string, boolean> = {};
    for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
      extras[extra] = EXTRA_MARKERS[extra].some((m: string) => names.has(m));
    }
    return { installed: true, version, extras };
  } catch {
    return { installed: false, version: null, extras: { code: false, ml: false } };
  }
}
