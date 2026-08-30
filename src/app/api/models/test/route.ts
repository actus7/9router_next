import { NextRequest, NextResponse } from "next/server";
import { pingModelByKind } from "./ping";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { model, kind, timeoutMs } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const result = await pingModelByKind(model, kind || "llm", undefined, timeoutMs);
    return NextResponse.json(result);
  } catch (err) {
    const error = err as Error;
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    return NextResponse.json({ ok: false, error: error.message, isTimeout }, { status: 500 });
  }
}
