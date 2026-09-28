import { NextRequest, NextResponse } from "next/server";
import {
  deleteCapability,
  forgetAllLearning,
  getCapabilityById,
  listCapabilities,
  setCapabilityStatus,
} from "@/lib/db/repos/synapseLoopRepo";
import { rejectLearned } from "@/server/synapse/loop";

// Dashboard surface of the Synapse Loop: what this account learned, and the
// operator's say over it. Every call is scoped by tenantRoute.

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function listSynapseCapabilities(): Promise<NextResponse> {
  return NextResponse.json({ capabilities: await listCapabilities() }, noStore);
}

/** "Forget everything Synapse learned." */
export async function forgetSynapseLearning(): Promise<NextResponse> {
  await forgetAllLearning();
  return NextResponse.json({ success: true });
}

type IdContext = { params: Promise<{ id: string }> };

/** Reactivate (back to shadow, re-proves itself) or retire a capability. */
export async function patchSynapseCapability(request: NextRequest, { params }: IdContext): Promise<NextResponse> {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  if (body.status !== "shadow" && body.status !== "deprecated") {
    return NextResponse.json({ error: "status must be 'shadow' or 'deprecated'" }, { status: 400 });
  }
  if (!(await getCapabilityById(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await setCapabilityStatus(id, body.status);
  return NextResponse.json({ success: true });
}

export async function deleteSynapseCapability(_request: NextRequest, { params }: IdContext): Promise<NextResponse> {
  const { id } = await params;
  await deleteCapability(id);
  return NextResponse.json({ success: true });
}

/** 👎 or "Regenerate" on an answer the chat marked as Synapse's. */
export async function rejectSynapseAnswer(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { input?: unknown };
  if (typeof body.input !== "string" || !body.input.trim() || body.input.length > 2000) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }
  await rejectLearned(body.input);
  return NextResponse.json({ success: true });
}
