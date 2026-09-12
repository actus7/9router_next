import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Where the browser sends Content Security Policy violations.
 *
 * The policy ships report-only (see `lib/security/contentSecurityPolicy.ts`)
 * and the part of it that cannot be read off the source is what the Puter SDK
 * reaches once it boots — inside the chat, behind a login. A console is not a
 * collector: it only tells whoever happens to have devtools open. This makes
 * the discovery phase self-service, and it is meant to be deleted when the
 * policy moves to enforce.
 *
 * Deliberately unauthenticated: a violation report arrives from a page that may
 * have just been blocked, and gating it behind a session would lose exactly the
 * reports worth having. It writes no rows — the tenancy rule ("every row
 * belongs to an account") is not bent, because there is no row.
 */

/** Past this, it is not a violation report. Chrome's are well under 2 KB. */
const MAX_REPORT_BYTES = 8 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_REPORT_BYTES) return new NextResponse(null, { status: 413 });
  const body = await request.text().catch(() => "");
  if (!body || body.length > MAX_REPORT_BYTES) return new NextResponse(null, { status: 204 });

  // Both shapes: `report-uri` posts `{"csp-report": {...}}`, `report-to` posts
  // an array of Reporting API entries. Neither is normalized — this is a log
  // line to read, not a record to query.
  console.warn("[csp-report]", body.slice(0, MAX_REPORT_BYTES));
  return new NextResponse(null, { status: 204 });
}
