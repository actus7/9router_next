import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dashboardRoot = join(process.cwd(), "src", "app", "(dashboard)");
const runtimeCall = "  await assertRequestRuntime();";

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (entry === "page.tsx") files.push(full);
  }
  return files;
}

function patchPage(filePath) {
  let source = readFileSync(filePath, "utf8");
  if (!source.includes("assertRequestRuntime")) return false;
  if (source.includes("await assertRequestRuntime()")) return false;

  const patched = source.replace(
    /(async function [^{]+\{)\r?\n/g,
    `$1\r\n${runtimeCall}\r\n`,
  );
  if (patched === source) return false;
  writeFileSync(filePath, patched);
  return true;
}

let count = 0;
for (const page of walk(dashboardRoot)) {
  if (patchPage(page)) count += 1;
}
console.log(`Added runtime call to ${count} dashboard pages.`);
