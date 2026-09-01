"use client";

import type { Connection, OneByOneResult } from "../types";

const ONE_BY_ONE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOneByOneTestLoop(
  connections: Connection[],
  stopRef: React.MutableRefObject<boolean>,
  onCurrentId: (id: string | null) => void,
  onResults: (updater: (prev: Record<string, OneByOneResult>) => Record<string, OneByOneResult>) => void,
  onSummary: (summary: { total: number; completed: number; passed: number; failed: number; stopped: boolean }) => void,
): Promise<void> {
  let passed = 0;
  let failed = 0;

  for (let index = 0; index < connections.length; index += 1) {
    if (stopRef.current) {
      onSummary({ total: connections.length, completed: index, passed, failed, stopped: true });
      break;
    }

    const connection = connections[index];
    onCurrentId(connection.id);
    onResults((prev) => ({ ...prev, [connection.id]: { state: "testing", error: null } }));

    try {
      const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      const valid = !!data.valid;
      if (valid) passed += 1; else failed += 1;
      onResults((prev) => ({ ...prev, [connection.id]: { state: valid ? "success" : "failed", error: valid ? null : (data.error || null) } }));
    } catch (error: unknown) {
      failed += 1;
      onResults((prev) => ({ ...prev, [connection.id]: { state: "failed", error: error instanceof Error ? error.message : "Test failed" } }));
    }

    onSummary({ total: connections.length, completed: index + 1, passed, failed, stopped: false });
    if (index < connections.length - 1) await sleep(ONE_BY_ONE_DELAY_MS);
  }
}
