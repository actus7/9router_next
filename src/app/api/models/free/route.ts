import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { FREE_PROVIDERS } from "@/shared/constants/providers";
import {
  getEligibleFreeModelProviders,
  resolveFreeModelGroups,
} from "@/server/application/use-cases/http/v1/models/freeModelGroups";

/**
 * GET /api/models/free
 * No-auth ("free" category) providers never have a connection row — this
 * lists their catalog models directly so chat can offer them without
 * requiring the user to add a connection first.
 */
async function handleGET(): Promise<NextResponse> {
  const groups = await resolveFreeModelGroups(getEligibleFreeModelProviders(FREE_PROVIDERS));
  return NextResponse.json({ groups });
}

export const GET = tenantRoute(handleGET);
