/**
 * Project ID Service - Fetch and cache real Project IDs from Google Cloud Code API
 *
 *
 * Instead of generating random project IDs (e.g. "useful-spark-a1b2c"),
 * this service fetches the real Project ID bound to the authenticated user's account.
 * This significantly reduces the risk of being flagged by Google's anti-abuse systems.
 */

import { CLOUD_CODE_API, LOAD_CODE_ASSIST_HEADERS, ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS, LOAD_CODE_ASSIST_METADATA } from "../config/appConstants";

// ─── Cache ────────────────────────────────────────────────────────────────────
// connectionId -> { projectId: string, fetchedAt: number }
const projectIdCache = new Map<string, { projectId: string; fetchedAt: number }>();

/** How long a cached project ID is considered fresh (1 hour). */
const CACHE_TTL_MS = 60 * 60 * 1000;

// ─── Pending-fetch deduplication ─────────────────────────────────────────────
// connectionId -> { promise: Promise<string|null>, controller: AbortController, startedAt: number }
const pendingFetches = new Map<string, { promise: Promise<string | null>; controller: AbortController; startedAt: number }>();

/** Abort and evict a pending fetch that has been running longer than this (2 min). */
const PENDING_TTL_MS = 2 * 60 * 1000;

// ─── Periodic cleanup ────────────────────────────────────────────────────────
/** How often the background sweep runs (10 min). */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Run one sweep immediately: evict stale cache entries and abort orphaned pending fetches. */
function cleanupNow(): void {
    const now = Date.now();

    for (const [id, entry] of projectIdCache) {
        if (!entry || now - entry.fetchedAt >= CACHE_TTL_MS) {
            projectIdCache.delete(id);
        }
    }

    for (const [id, item] of pendingFetches) {
        if (!item || typeof item.startedAt !== "number") {
            pendingFetches.delete(id);
            continue;
        }
        if (now - item.startedAt > PENDING_TTL_MS) {
            try { item.controller.abort(); } catch (_) { /* ignore */ }
            pendingFetches.delete(id);
        }
    }
}

/** Start the periodic background cleanup (idempotent). Called automatically on module load. */
function startCacheCleanup(): void {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => {
        try { cleanupNow(); } catch (e: unknown) {
            console.warn("[ProjectId] cleanup sweep error:", e instanceof Error ? e.message : e);
        }
    }, CLEANUP_INTERVAL_MS);
    // Unref so the timer doesn't prevent Node from exiting when it is otherwise idle
    _cleanupTimer?.unref?.();
}

/** Stop the periodic background cleanup (e.g. during graceful shutdown). */
function stopCacheCleanup(): void {
    if (!_cleanupTimer) return;
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
}

// Start automatically when the module is first imported
startCacheCleanup();

// ─── Public API ───────────────────────────────────────────────────────────────

interface CloudCodeEndpoints {
  loadCodeAssist: string;
  onboardUser: string;
}

/**
 * Get the Project ID for a connection, with caching.
 * Returns null on failure (callers should fall back to random generation).
 *
 * @param {string} connectionId - The connection identifier for cache keying
 * @param {string} accessToken  - Valid OAuth access token
 * @returns {Promise<string|null>} Real project ID or null
 */
export async function getProjectIdForConnection(connectionId: string, accessToken: string, provider: string = "gemini-cli"): Promise<string | null> {
    if (!connectionId || !accessToken) return null;

    // Return cached value if still fresh
    const cached = projectIdCache.get(connectionId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.projectId;
    }

    // Deduplicate concurrent fetches for the same connection
    if (pendingFetches.has(connectionId)) {
        return pendingFetches.get(connectionId)!.promise;
    }

    // Each fetch gets its own AbortController so it can be canceled via removeConnection()
    const controller = new AbortController();

    const promise = (async () => {
        try {
            const projectId = await fetchProjectId(accessToken, controller.signal, provider);
            if (projectId) {
                projectIdCache.set(connectionId, {projectId, fetchedAt: Date.now()});
                return projectId;
            }
            console.warn("[ProjectId] could not fetch projectId for connection", connectionId.slice(0, 8));
            return null;
        } catch (error: unknown) {
            console.warn(`[ProjectId] Error fetching project ID: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        } finally {
            pendingFetches.delete(connectionId);
        }
    })();

    pendingFetches.set(connectionId, {promise, controller, startedAt: Date.now()});
    return promise;
}

/**
 * Invalidate the cached project ID for a connection.
 * Call this when a connection's credentials are fully revoked or refreshed.
 */
export function invalidateProjectId(connectionId: string): void {
    projectIdCache.delete(connectionId);
}

/**
 * Fully remove a connection: abort any in-flight fetch and delete its cached project ID.
 * Wire this into your connection close / disconnect lifecycle events to prevent memory leaks.
 *
 * @param {string} connectionId
 */
function removeConnection(connectionId: string): void {
    if (!connectionId) return;
    projectIdCache.delete(connectionId);
    const pending = pendingFetches.get(connectionId);
    if (pending) {
        try { pending.controller.abort(); } catch (_) { /* ignore */ }
        pendingFetches.delete(connectionId);
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch project ID via loadCodeAssist endpoint.
 * Falls back to onboardUser when loadCodeAssist returns no project.
 *
 * @param {string}      accessToken
 * @param {AbortSignal} signal
 * @returns {Promise<string|null>}
 */
async function fetchProjectId(accessToken: string, signal: AbortSignal, provider: string): Promise<string | null> {
    const endpoints = (CLOUD_CODE_API as Record<string, CloudCodeEndpoints>)[provider] || (CLOUD_CODE_API as Record<string, CloudCodeEndpoints>)["gemini-cli"];
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const response = await fetch(endpoints.loadCodeAssist, {
        method: "POST",
        headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
        body: JSON.stringify({ metadata: LOAD_CODE_ASSIST_METADATA }),
        signal
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`loadCodeAssist failed: HTTP ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const projectId = extractProjectId(data);
    if (projectId) return projectId;

    // Determine the tier to use for onboarding
    let tierID = "legacy-tier";
    if (Array.isArray(data.allowedTiers)) {
        for (const tier of data.allowedTiers) {
            if (tier && typeof tier === "object" && tier.isDefault === true) {
                if (tier.id && typeof tier.id === "string" && tier.id.trim()) {
                    tierID = tier.id.trim();
                    break;
                }
            }
        }
    }

    return onboardUser(accessToken, tierID, signal, endpoints, provider);
}

/**
 * Fetch project ID via onboardUser endpoint (polls until done).
 *
 * @param {string}      accessToken
 * @param {string}      tierID
 * @param {AbortSignal} externalSignal  – propagated from the connection's AbortController
 * @returns {Promise<string|null>}
 */
async function onboardUser(accessToken: string, tierID: string, externalSignal: AbortSignal, endpoints: CloudCodeEndpoints, provider: string): Promise<string | null> {
    console.log(`[ProjectId] Onboarding user with tier: ${tierID}`);

    const reqBody = { tierId: tierID, metadata: LOAD_CODE_ASSIST_METADATA };
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Bail out immediately if the connection was removed
        if (externalSignal?.aborted) return null;

        // Per-attempt timeout controller; forwards external abort as well
        const localCtrl = new AbortController();
        const timeoutId = setTimeout(() => localCtrl.abort(), 30_000);
        const forwardAbort = () => localCtrl.abort();
        externalSignal?.addEventListener("abort", forwardAbort);

        try {
            const response = await fetch(endpoints.onboardUser, {
                method: "POST",
                headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
                body: JSON.stringify(reqBody),
                signal: localCtrl.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                throw new Error(`onboardUser HTTP ${response.status}: ${errorText.slice(0, 200)}`);
            }

            const data = await response.json();

            if (data.done === true) {
                const projectId = extractProjectIdFromOnboard(data);
                if (projectId) {
                    console.error(`[ProjectId] Successfully onboarded, project ID: ${projectId}`);
                    return projectId;
                }
                throw new Error("onboardUser done but no project_id in response");
            }

            // Server not done yet – wait and retry
            console.error(`[ProjectId] Onboard attempt ${attempt}/${MAX_ATTEMPTS}: not done yet, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error: unknown) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                console.warn(`[ProjectId] onboardUser attempt ${attempt} aborted (timeout or connection removed)`);
                if (externalSignal?.aborted) return null;   // connection gone – stop retrying
                continue;
            }
            if (attempt === MAX_ATTEMPTS) {
                console.warn(`[ProjectId] onboardUser failed after ${MAX_ATTEMPTS} attempts: ${error instanceof Error ? error.message : String(error)}`);
                return null;
            }
            // Continue to next attempt instead of throwing (which would skip remaining retries)
            console.warn(`[ProjectId] onboardUser attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } finally {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener("abort", forwardAbort);
        }
    }

    return null;
}

/**
 * Extract project ID from loadCodeAssist response.
 */
function extractProjectId(data: Record<string, unknown>): string | null {
    if (!data) return null;

    if (typeof data.cloudaicompanionProject === "string") {
        const id = data.cloudaicompanionProject.trim();
        if (id) return id;
    }

    if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject === "object") {
        const id = (data.cloudaicompanionProject as Record<string, unknown>).id;
        if (typeof id === "string" && id.trim()) return id.trim();
    }

    return null;
}

/**
 * Extract project ID from onboardUser response.
 */
function extractProjectIdFromOnboard(data: Record<string, unknown>): string | null {
    if (!data?.response) return null;

    const response = data.response as Record<string, unknown>;
    const project = response.cloudaicompanionProject;

    if (typeof project === "string") {
        const id = project.trim();
        if (id) return id;
    }

    if (project && typeof project === "object") {
        const id = (project as Record<string, unknown>).id;
        if (typeof id === "string" && id.trim()) return id.trim();
    }

    return null;
}
