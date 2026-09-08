import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse } from "next/server";
import { pingModelByKind } from "./ping";

// POST /api/models/test - Ping a single model via internal completions or embeddings
async function handlePOST(request: NextRequest): Promise<NextResponse> {
  try {
    const { model, kind, timeoutMs } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const result = await pingModelByKind(model, kind || "llm", undefined, timeoutMs, request.signal);
    return NextResponse.json(result);
  } catch (err) {
    const error = err as Error;
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    return NextResponse.json({ ok: false, error: error.message, isTimeout, isCancelled: error.name === "AbortError" }, { status: 500 });
  }
}

export const POST = tenantRoute(handlePOST);
