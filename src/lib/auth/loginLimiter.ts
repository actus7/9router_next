// In-memory progressive lockout for dashboard login. Resets on process restart.
import { hasTrustedPeerHeaders } from "./trustedPeer";

const MAX_FAILS_BEFORE_LOCK: number = 5;
const LOCK_STEPS_MS: readonly number[] = [30_000, 120_000, 600_000, 1_800_000]; // 30s, 2m, 10m, 30m
const FAIL_WINDOW_MS: number = 60 * 60 * 1000; // 1h since last fail → auto reset

interface AttemptEntry {
  fails: number;
  lockUntil: number;
  lockLevel: number;
  lastFailAt: number;
}

interface LockResult {
  locked: boolean;
  retryAfter?: number;
}

interface FailResult {
  remainingBeforeLock: number;
}

const attempts: Map<string, AttemptEntry> = new Map(); // ip → { fails, lockUntil, lockLevel, lastFailAt }

function now(): number { return Date.now(); }

function getEntry(ip: string): AttemptEntry | null {
  const e: AttemptEntry | undefined = attempts.get(ip);
  if (!e) return null;
  // Auto reset if window expired and not currently locked
  if (e.lastFailAt && now() - e.lastFailAt > FAIL_WINDOW_MS && (!e.lockUntil || now() >= e.lockUntil)) {
    attempts.delete(ip);
    return null;
  }
  return e;
}

export function checkLock(ip: string): LockResult {
  const e: AttemptEntry | null = getEntry(ip);
  if (!e || !e.lockUntil) return { locked: false };
  const remaining: number = e.lockUntil - now();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

export function recordFail(ip: string): FailResult {
  const e: AttemptEntry = getEntry(ip) || { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
  e.fails += 1;
  e.lastFailAt = now();
  if (e.fails >= MAX_FAILS_BEFORE_LOCK) {
    const step: number = LOCK_STEPS_MS[Math.min(e.lockLevel, LOCK_STEPS_MS.length - 1)];
    e.lockUntil = now() + step;
    e.lockLevel += 1;
    e.fails = 0;
  }
  attempts.set(ip, e);
  return { remainingBeforeLock: Math.max(0, MAX_FAILS_BEFORE_LOCK - e.fails) };
}

export function recordSuccess(ip: string): void {
  attempts.delete(ip);
}

interface RequestWithHeaders {
  headers: {
    get(name: string): string | null;
  };
}

export function getClientIp(request: RequestWithHeaders): string {
  // Trusted only when custom-server.js proves it stamped the header from the TCP socket;
  // otherwise a client could rotate the value to escape its own lockout bucket.
  if (hasTrustedPeerHeaders(request)) {
    const realIp: string | null = request.headers.get("x-9r-real-ip");
    if (realIp) return realIp;
  }
  // Behind a trusted reverse proxy that overwrites XFF with the real client IP.
  if (process.env.TRUST_PROXY === "true") {
    const xff: string | null = request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  // Direct exposure without custom-server: single bucket so spoofed XFF
  // rotation cannot escape the limiter.
  return "unknown";
}
