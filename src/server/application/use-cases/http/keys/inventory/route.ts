import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/db/repos/apiKeysRepo";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";

/**
 * Where every API key was propagated to.
 *
 * This is the answer that did not exist before: the same key was written to CLI
 * config files, pushed as a cloud env var and handed to the user, with no record
 * of which. Revoking it broke everything at once and there was no way to know
 * what to reconfigure, so in practice keys were never rotated.
 *
 * Deliberately never returns the key itself — an endpoint that lists where
 * secrets went must not also hand them out. `keyPrefix` is enough to match a
 * row against a key the operator is holding.
 */

/** Enough to identify a key by eye, not enough to use it. */
function maskKey(key: string): string {
  return key.length <= 12 ? "sk-…" : `${key.slice(0, 12)}…`;
}

export async function GET(): Promise<NextResponse> {
  // Never prerender a listing of where secrets were sent.
  await assertRequestRuntime();
  try {
    const keys = await getApiKeys();

    const entries = keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: maskKey(key.key),
      sink: key.sink,
      sinkRef: key.sinkRef,
      isActive: key.isActive,
      createdAt: key.createdAt,
      revokedAt: key.revokedAt,
    }));

    const bySink: Record<string, number> = {};
    for (const entry of entries) {
      if (!entry.isActive) continue;
      bySink[entry.sink] = (bySink[entry.sink] ?? 0) + 1;
    }

    return NextResponse.json({
      keys: entries,
      activeBySink: bySink,
      // Rows that predate the sink columns, or keys the operator made by hand.
      // Nothing knows where these went — they are the residue of the old
      // one-key-everywhere behaviour and the only ones rotation cannot trace.
      untracedCount: entries.filter((entry) => entry.isActive && entry.sink === "manual").length,
    });
  } catch (error) {
    console.error("Error building key inventory:", error);
    return NextResponse.json({ error: "Failed to build key inventory" }, { status: 500 });
  }
}
