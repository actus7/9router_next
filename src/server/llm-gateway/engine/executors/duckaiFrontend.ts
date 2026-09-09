import { DUCKAI_USER_AGENT as UA } from "./duckaiChallengeTypes";

/**
 * The duck.ai front end stamps its build into every chat request, and the
 * challenge is validated against it. Both halves sit on the `<html>` tag:
 *
 *   <html data-version-tag="serp_20260909_143633_ET"
 *         data-version-sha="dc59730c41b9e3a57d9a2783fdfb007ec00a2a15">
 *
 * joined with "-" to form `x-fe-version`. The entry bundle's hashed filename
 * is in the same document and is what the `meta.stack` frames point at. Both
 * change on every duck.ai deploy, so they are read from the live page rather
 * than pinned here, and cached for an hour so this costs one request.
 */
const DUCKAI_APP_URL = "https://duck.ai/";
const FRONTEND_CACHE_MS = 60 * 60 * 1000;

export type DuckAiFrontend = { bundleUrl: string; feVersion: string };

let frontendCache: { at: number; value: DuckAiFrontend } | null = null;

export async function fetchDuckAiFrontend(): Promise<DuckAiFrontend | null> {
  if (frontendCache && Date.now() - frontendCache.at < FRONTEND_CACHE_MS) {
    return frontendCache.value;
  }
  try {
    // Deliberately not duckaiRuntime's fetchWithTimeout: importing it back
    // would make these two modules a cycle for one helper.
    const response = await fetch(DUCKAI_APP_URL, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return frontendCache?.value ?? null;
    const html = await response.text();
    const tag = html.match(/data-version-tag="([^"]+)"/)?.[1];
    const sha = html.match(/data-version-sha="([^"]+)"/)?.[1];
    const bundle = html.match(/entry\.duckai\.[0-9a-f]+\.js/)?.[0];
    if (!tag || !sha || !bundle) return frontendCache?.value ?? null;
    const value: DuckAiFrontend = {
      bundleUrl: `https://duck.ai/dist/duckai-dist/${bundle}`,
      feVersion: `${tag}-${sha}`,
    };
    frontendCache = { at: Date.now(), value };
    return value;
  } catch {
    // A failed lookup must not take the chat down with it: the request still
    // goes out, just without the stamp.
    return frontendCache?.value ?? null;
  }
}
