import fs from "fs";
import path from "path";
import { PXPIPE_DIR } from "./install";

const EVENTS_FILE: string = path.join(PXPIPE_DIR, "events.jsonl");
const ROTATED_FILE: string = path.join(PXPIPE_DIR, "events.jsonl.1");
const MAX_FILE_BYTES: number = 5 * 1024 * 1024;
const DAY_MS: number = 24 * 60 * 60 * 1000;

function ensureDir(): void {
  if (!fs.existsSync(PXPIPE_DIR)) fs.mkdirSync(PXPIPE_DIR, { recursive: true });
}

interface PxpipeEvent {
  ts: number;
  applied?: boolean;
  reason?: string;
  tokensBeforeEst?: number;
  tokensAfterEst?: number;
  tokensSavedEst?: number;
  imageCount?: number;
  durationMs?: number;
  [key: string]: unknown;
}

// Fire-and-forget: stats must never break the request path.
export function appendPxpipeEvent(event: Record<string, unknown>): void {
  try {
    ensureDir();
    try {
      const stat: fs.Stats = fs.statSync(EVENTS_FILE);
      if (stat.size > MAX_FILE_BYTES) fs.renameSync(EVENTS_FILE, ROTATED_FILE);
    } catch { /* no file yet */ }
    fs.appendFile(EVENTS_FILE, JSON.stringify({ ts: Date.now(), ...event }) + "\n", () => {});
  } catch { /* ignore */ }
}

interface ReadEventsOptions {
  sinceMs?: number | null;
  limit?: number | null;
}

export function readPxpipeEvents({ sinceMs = null, limit = null }: ReadEventsOptions = {}): PxpipeEvent[] {
  const events: PxpipeEvent[] = [];
  for (const file of [ROTATED_FILE, EVENTS_FILE]) {
    try {
      // PXPipe logs are runtime files under the user's data directory.
      if (!fs.existsSync(/*turbopackIgnore: true*/ file)) continue;
      for (const line of fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").split("\n")) {
        if (!line) continue;
        try {
          const ev: PxpipeEvent = JSON.parse(line);
          if (sinceMs && ev.ts < sinceMs) continue;
          events.push(ev);
        } catch { /* skip corrupt line */ }
      }
    } catch { /* ignore */ }
  }
  events.sort((a: PxpipeEvent, b: PxpipeEvent) => a.ts - b.ts);
  return limit ? events.slice(-limit) : events;
}

interface PxpipeTotals {
  requests: number;
  compressed: number;
  bypassed: number;
  errors: number;
  tokensBeforeEst: number;
  tokensAfterEst: number;
  tokensSavedEst: number;
  savedPct: number;
  imagesGenerated: number;
  compressionTimeMs: number;
  avgCompressionMs: number;
}

function emptyTotals(): PxpipeTotals {
  return {
    requests: 0, compressed: 0, bypassed: 0, errors: 0,
    tokensBeforeEst: 0, tokensAfterEst: 0, tokensSavedEst: 0, savedPct: 0,
    imagesGenerated: 0, compressionTimeMs: 0, avgCompressionMs: 0,
  };
}

function accumulate(totals: PxpipeTotals, ev: PxpipeEvent): void {
  totals.requests++;
  if (ev.applied) {
    totals.compressed++;
    totals.tokensBeforeEst += ev.tokensBeforeEst || 0;
    totals.tokensAfterEst += ev.tokensAfterEst || 0;
    totals.tokensSavedEst += ev.tokensSavedEst || 0;
    totals.imagesGenerated += ev.imageCount || 0;
    totals.compressionTimeMs += ev.durationMs || 0;
  } else if (ev.reason === "transform_error" || ev.reason === "timeout") {
    totals.errors++;
  } else {
    totals.bypassed++;
  }
}

function finalize(totals: PxpipeTotals): PxpipeTotals {
  totals.savedPct = totals.tokensBeforeEst > 0
    ? +((totals.tokensSavedEst / totals.tokensBeforeEst) * 100).toFixed(2)
    : 0;
  totals.avgCompressionMs = totals.compressed > 0
    ? Math.round(totals.compressionTimeMs / totals.compressed)
    : 0;
  return totals;
}

interface TimelineDay {
  date: string;
  tokensSavedEst: number;
  compressed: number;
  requests: number;
}

interface PxpipeStats {
  windows: Record<string, PxpipeTotals>;
  timeline: TimelineDay[];
  recent: PxpipeEvent[];
}

// Aggregated stats for the dashboard: all-time + windowed totals, a daily
// tokens-saved timeline (last `timelineDays`), and the most recent events.
export function getPxpipeStats({ timelineDays = 30, recentLimit = 100 }: { timelineDays?: number; recentLimit?: number } = {}): PxpipeStats {
  const events: PxpipeEvent[] = readPxpipeEvents();
  const now: number = Date.now();
  const startOfToday: number = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();

  const windows: Record<string, PxpipeTotals> = {
    all: emptyTotals(),
    today: emptyTotals(),
    yesterday: emptyTotals(),
    last7d: emptyTotals(),
    last30d: emptyTotals(),
  };

  const timeline: Map<string, TimelineDay> = new Map();
  for (let i = timelineDays - 1; i >= 0; i--) {
    const day: Date = new Date(startOfToday - i * DAY_MS);
    timeline.set(day.toISOString().slice(0, 10), { date: day.toISOString().slice(0, 10), tokensSavedEst: 0, compressed: 0, requests: 0 });
  }

  for (const ev of events) {
    accumulate(windows.all, ev);
    if (ev.ts >= startOfToday) accumulate(windows.today, ev);
    else if (ev.ts >= startOfToday - DAY_MS) accumulate(windows.yesterday, ev);
    if (ev.ts >= now - 7 * DAY_MS) accumulate(windows.last7d, ev);
    if (ev.ts >= now - 30 * DAY_MS) accumulate(windows.last30d, ev);

    const key: string = new Date(ev.ts).toISOString().slice(0, 10);
    const bucket: TimelineDay | undefined = timeline.get(key);
    if (bucket) {
      bucket.requests++;
      if (ev.applied) {
        bucket.compressed++;
        bucket.tokensSavedEst += ev.tokensSavedEst || 0;
      }
    }
  }

  for (const w of Object.values(windows)) finalize(w);

  return {
    windows,
    timeline: [...timeline.values()],
    recent: events.slice(-recentLimit).reverse(),
  };
}
