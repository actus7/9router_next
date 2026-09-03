/**
 * Injects assertRequestRuntime() at the start of exported GET/POST/PATCH/PUT/DELETE handlers
 * in App Router route files so Cache Components can prerender without unstable data errors.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const apiRoot = join(projectRoot, "src", "app", "api");
const useCaseRoot = join(projectRoot, "src", "server", "application", "use-cases", "http");
const importLine =
  'import { assertRequestRuntime } from "@/server/application/http/requestRuntime";';
const runtimeCall = "  await assertRequestRuntime();";

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (entry === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

function patchRoute(filePath) {
  let source = readFileSync(filePath, "utf8");
  if (source.includes("assertRequestRuntime")) return false;

  const methodPattern = /export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\) \{\n/;
  if (!methodPattern.test(source)) return false;

  if (!source.includes(importLine)) {
    const lastImportIdx = source.lastIndexOf("\nimport ");
    const afterImports = source.indexOf("\n", lastImportIdx) + 1;
    source = `${source.slice(0, afterImports)}${importLine}\n${source.slice(afterImports)}`;
  }

  source = source.replace(
    /export async function (GET|POST|PUT|PATCH|DELETE)\(([^)]*)\) \{\n/g,
    (match) => `${match}${runtimeCall}\n`,
  );

  writeFileSync(filePath, source);
  return true;
}

const routes = [...walk(apiRoot), ...walk(useCaseRoot)];
let patched = 0;
for (const route of routes) {
  if (patchRoute(route)) patched += 1;
}

console.log(`Patched ${patched} API route files with assertRequestRuntime.`);
