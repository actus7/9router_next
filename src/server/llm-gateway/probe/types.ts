/**
 * The one answer shape for "does this credential work".
 *
 * Before this existed the validate family alone had five return conventions:
 * `boolean`, `boolean | null`, `boolean | NextResponse`, `NextResponse | null`
 * and `NextResponse`. Two of them mixed a domain answer with an HTTP artifact,
 * which is why a probe could decide the route's response and no caller could
 * treat probes uniformly. Probes return this; routes turn it into HTTP.
 */
export interface ProbeResult {
  ok: boolean;
  /** Operator-facing reason. Null when the probe passed. */
  error: string | null;
  /** Upstream HTTP status, when the probe got one. */
  status?: number;
  /**
   * The credential works but the account has a condition worth surfacing, such
   * as an exhausted balance. Callers keep the connection usable and show this.
   */
  warning?: string | null;
  /** A token was refreshed while probing, so the caller should persist it. */
  refreshed?: boolean;
  newTokens?: Record<string, unknown> | null;
  /**
   * The probe never ran because configuration is missing, not because the
   * credential is bad. Kept separate so a route can answer "no such node"
   * differently from "this key was rejected" without a probe naming a status.
   */
  configError?: "missing-node" | "missing-config";
}

export function probeOk(extra: Omit<Partial<ProbeResult>, "ok" | "error"> = {}): ProbeResult {
  return { ok: true, error: null, ...extra };
}

export function probeFailed(error: string, extra: Omit<Partial<ProbeResult>, "ok" | "error"> = {}): ProbeResult {
  return { ok: false, error, ...extra };
}

/**
 * `null` from a probe means "not my case, keep walking the chain". Naming it
 * keeps that convention explicit instead of implied by a bare union.
 */
export type MaybeProbeResult = ProbeResult | null;

/**
 * The statuses that mean the credential itself was refused. Everything else,
 * including a 400 for an unknown probe model or a 404 for a missing route,
 * still proves the credential was accepted. Nine probes spelled this out
 * inline before, and they did not all agree.
 */
export const CREDENTIAL_REJECTED_STATUSES: ReadonlySet<number> = new Set([401, 403]);

export function verdictFromStatus(
  status: number,
  error: string,
  rejected: ReadonlySet<number> = CREDENTIAL_REJECTED_STATUSES,
): ProbeResult {
  return rejected.has(status) ? probeFailed(error, { status }) : probeOk({ status });
}
