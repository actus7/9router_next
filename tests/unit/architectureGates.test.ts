import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(__dirname, "../..");
const sourceRoot = join(projectRoot, "src");

function listSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
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
  "app/globals.css": 993,
  "components/ui/sidebar.tsx": 723,
};

/**
 * Slice gates are enabled incrementally as each vertical slice is completed.
 * Add a directory path (relative to src/) to activate enforcement for that slice.
 */
const sliceGates = {
  noRawPaletteColors: [
    "app/(dashboard)/dashboard/providers",
    "app/(dashboard)/dashboard/providers/[id]",
  ],
  // The probe engine was written after the ProbeResult consolidation, so it
  // starts clean and stays that way.
  noUnknownAsCasts: ["server/llm-gateway/probe"] as string[],
  // An empty list makes the gate below pass without inspecting anything, so a
  // directory only counts as protected once it is listed here.
  noEmptyCatch: [
    "server/application/use-cases/http/providers",
  ],
  requireRouteBoundaries: [
    "app/(dashboard)/dashboard/providers",
    "app/(dashboard)/dashboard/providers/[id]",
    "app/(dashboard)/dashboard/combos",
    "app/(dashboard)/dashboard/combos/[id]",
    "app/(dashboard)/dashboard/media-providers/[kind]/[id]",
  ],
} as const;

function sliceRoots(relativePaths: readonly string[]): string[] {
  // `join` already normalizes "/" to the platform separator. Converting to "\"
  // first made every one of these paths a literal directory name on Linux, so
  // the slices resolved to nothing and the gates below reported "slice root
  // missing or empty" — they only ever ran on Windows.
  return relativePaths.map((entry) => join(sourceRoot, entry));
}

function collectSliceViolations(
  relativePaths: readonly string[],
  predicate: (source: string, path: string) => string | null,
): string[] {
  return relativePaths.flatMap((relativePath, index) => {
    const root = sliceRoots(relativePaths)[index];
    const files = listSourceFiles(root);
    // A moved or mistyped slice path would otherwise scan zero files and report
    // the gate as clean, which is worse than not having the gate at all.
    if (files.length === 0) return [`${relativePath}: slice root missing or empty`];
    return files.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const violation = predicate(source, path);
      return violation ? [violation] : [];
    });
  });
}

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

  it("keeps application status feedback on semantic color tokens", () => {
    const roots = [
      join(sourceRoot, "shared"),
      join(sourceRoot, "app", "(dashboard)", "dashboard"),
    ];
    const intentionalDataColorFiles = new Set<string>();
    const rawStatusColor = /(?:bg|text|border|ring)-(?:red|green|yellow|amber|blue)-\d+(?:\/\d+)?/;
    const violations = roots.flatMap(listSourceFiles)
      .filter((path) => /\.tsx$/.test(path) && !intentionalDataColorFiles.has(path))
      .filter((path) => rawStatusColor.test(readFileSync(path, "utf8")))
      .map((path) => relative(projectRoot, path));

    expect(violations).toEqual([]);
  });

  it("enforces slice gates for raw palette colors when enabled", () => {
    const hexColor = /(?:bg|text|border|ring|from|to|via|fill|stroke)-\[#(?:[0-9a-fA-F]{3,8})\]/;
    const rawPalette = /(?:bg|text|border|ring)-(?:gray|zinc|slate|neutral|stone|purple|blue|green|red|yellow|amber|orange|pink|indigo|violet|fuchsia|cyan|teal|emerald|lime|sky|rose)-\d+/;
    const violations = collectSliceViolations(sliceGates.noRawPaletteColors, (source, path) => {
      if (!/\.tsx$/.test(path)) return null;
      if (hexColor.test(source) || rawPalette.test(source)) {
        return relative(projectRoot, path);
      }
      return null;
    });

    expect(violations).toEqual([]);
  });

  it("enforces slice gates for unknown-as casts when enabled", () => {
    const violations = collectSliceViolations(sliceGates.noUnknownAsCasts, (source, path) => {
      if (!/\.(?:ts|tsx)$/.test(path)) return null;
      return /as unknown as/.test(source) ? relative(projectRoot, path) : null;
    });

    expect(violations).toEqual([]);
  });

  it("enforces slice gates for empty catch blocks when enabled", () => {
    const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
    const violations = collectSliceViolations(sliceGates.noEmptyCatch, (source, path) => {
      if (!/\.(?:ts|tsx)$/.test(path)) return null;
      return emptyCatch.test(source) ? relative(projectRoot, path) : null;
    });

    expect(violations).toEqual([]);
  });

  it("enforces slice gates for route loading and error boundaries when enabled", () => {
    const violations = sliceGates.requireRouteBoundaries.flatMap((relativeRouteDir) => {
      // Same Windows-only conversion as sliceRoots had; `join` handles "/".
      const routeDir = join(sourceRoot, relativeRouteDir);
      if (!existsSync(routeDir)) return [`${relativeRouteDir}: directory missing`];

      const hasPage = listSourceFiles(routeDir).some((path) => /page\.tsx$/.test(path));
      if (!hasPage) return [];

      const missing: string[] = [];
      if (!existsSync(join(routeDir, "loading.tsx"))) missing.push(`${relativeRouteDir}/loading.tsx`);
      if (!existsSync(join(routeDir, "error.tsx"))) missing.push(`${relativeRouteDir}/error.tsx`);
      return missing;
    });

    expect(violations).toEqual([]);
  });
});

export { sliceGates };
