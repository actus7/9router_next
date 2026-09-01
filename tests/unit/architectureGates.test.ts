import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(__dirname, "../..");
const sourceRoot = join(projectRoot, "src");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(?:ts|tsx|js|jsx|css)$/.test(entry) ? [path] : [];
  });
}

function countLines(source: string): number {
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

const justifiedLargeFileCeilings: Record<string, number> = {
  // Global CSS tokens and shadcn's registry-owned sidebar are intentional
  // composition boundaries; Prisma artifacts are excluded below as generated.
  "app/globals.css": 969,
  "components/ui/sidebar.tsx": 723,
};

describe("architecture gates", () => {
  it("keeps Next Route Handlers as thin transport adapters", () => {
    const apiRoot = join(sourceRoot, "app", "api");
    const violations = listSourceFiles(apiRoot)
      .filter((path) => path.endsWith("route.ts"))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const lineCount = countLines(source);
        const importsInfrastructure = /@\/lib\/db\/(?:repos|driver)(?:\/|["'])/.test(source);
        return lineCount > 200 || importsInfrastructure
          ? [`${relative(projectRoot, path)} (${lineCount} lines${importsInfrastructure ? ", imports persistence" : ""})`]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it("rejects new large files and growth beyond documented exceptions", () => {
    const violations = listSourceFiles(sourceRoot).flatMap((path) => {
      const relativePath = relative(sourceRoot, path).replaceAll("\\", "/");
      if (relativePath === "prisma/contract.d.ts" || relativePath === "prisma/contract.json") return [];
      const lineCount = countLines(readFileSync(path, "utf8"));
      if (lineCount <= 600) return [];
      const ceiling = justifiedLargeFileCeilings[relativePath];
      return ceiling !== undefined && lineCount <= ceiling
        ? []
        : [`${relativePath}: ${lineCount} lines (allowed: ${ceiling ?? 600})`];
    });

    expect(violations).toEqual([]);
  });
});
