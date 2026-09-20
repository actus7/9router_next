import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A page may not establish the tenant around a return it defers.
 *
 * `withTenantPage` enters an AsyncLocalStorage scope for the duration of its
 * callback. Everything the callback *awaits* is inside it; everything React
 * renders *later* is not — React resumes a suspended child under a context
 * snapshot it captured before the scope existed. So a page shaped like
 *
 *   return withTenantPage(async () => <Suspense><ReadsTenant /></Suspense>)
 *
 * type-checks, builds, and throws `TenantContextError` on every visit, because
 * `ReadsTenant` runs after the scope closed. `withTenantPage` already documents
 * this trap for `enterWith()`; a `<Suspense>` boundary between the `run()` and
 * the read reopens it, and nothing else in the suite notices.
 *
 * `/dashboard/media-providers/[kind]` shipped this way. The working shape —
 * used by every sibling listing — puts `withTenantPage` *inside* the component
 * under the boundary, so the scope covers the read that needs it.
 */
const appRoot = resolve(__dirname, "../../src/app");

function listPages(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listPages(path);
    return entry === "page.tsx" ? [path] : [];
  });
}

/** The default export's body: these pages declare it last, after their helpers. */
function defaultExportBody(source: string): string {
  const start = source.indexOf("export default");
  return start === -1 ? "" : source.slice(start);
}

describe("tenant scope and Suspense", () => {
  it("no page establishes the tenant around a deferred subtree", () => {
    const offenders = listPages(appRoot)
      .filter((path) => {
        const body = defaultExportBody(readFileSync(path, "utf-8"));
        return body.includes("withTenantPage(") && body.includes("<Suspense");
      })
      .map((path) => relative(appRoot, path).split(sep).join("/"));

    expect(offenders, "move withTenantPage into the component under <Suspense>").toEqual([]);
  });
});
