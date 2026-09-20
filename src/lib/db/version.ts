import fs from "node:fs";
import path from "node:path";

let cachedVersion: string | null = null;

export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath: string = path.join(process.cwd(), "package.json");
    const pkg: { version?: string } = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    cachedVersion = pkg.version || "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}
