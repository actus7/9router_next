import { NextResponse } from "next/server";
import { tenantRoute } from "@/server/application/http/tenantRoute";
import { getModelParamInfo } from "@/server/application/use-cases/smart-routing/modelParamInfo";

/** Thin transport adapter: the configurable parameters and accounts behind one lane entry. */
async function handleGET(request: Request): Promise<NextResponse> {
  const model = new URL(request.url).searchParams.get("model") ?? "";
  if (!model.includes("/")) return NextResponse.json({ error: "model must be provider/model" }, { status: 400 });
  return NextResponse.json(await getModelParamInfo(model), { headers: { "cache-control": "no-store" } });
}

export const GET = tenantRoute(handleGET);
