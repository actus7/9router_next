/**
 * Fails the build when an API route was prerendered as static content.
 *
 * Under Cache Components, a GET route handler that only reads the database or
 * live process state looks static to Next: nothing in the request is touched, so
 * no dynamic access is tracked. Next then bakes the response body at build time
 * and serves it forever. That is invisible in unit tests and in `next dev` — the
 * build artifact is the only place it shows up, which is why this check reads it.
 *
 * The fix for a flagged route is `await assertRequestRuntime()` at the top of the
 * handler. Only add to ALLOWED_STATIC when the response is a genuine constant.
 */
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const apiDir = join(distDir, "server", "app", "api");

// Empty on purpose: no route currently has a genuinely constant response.
// `/api/init` used to be listed here and was deleted — it returned the literal
// "Initialized", had no callers, and its name misled readers into thinking it
// held the bootstrap logic (which lives in src/instrumentation.ts and the lazy
// getAdapter()).
const ALLOWED_STATIC = new Set([]);

async function collectBodies(dir, found = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return found;
    throw error;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectBodies(full, found);
    else if (entry.name.endsWith(".body")) found.push(full);
  }
  return found;
}

try {
  await stat(apiDir);
} catch {
  console.error(`No build output at ${apiDir}. Run \`next build\` before this check.`);
  process.exit(1);
}

const bodies = await collectBodies(apiDir);
const offenders = bodies
  .map((file) => `/api/${relative(apiDir, file).replace(/\\/g, "/").replace(/\.body$/, "")}`)
  .filter((route) => !ALLOWED_STATIC.has(route))
  .sort();

if (offenders.length > 0) {
  console.error(
    `${offenders.length} API route(s) were prerendered as static content and will serve a\n` +
      "build-time response forever. Add `await assertRequestRuntime()` to each handler:\n",
  );
  for (const route of offenders) console.error(`  ${route}`);
  process.exit(1);
}

console.log(`No API route was prerendered as static content (${bodies.length} allowlisted).`);
