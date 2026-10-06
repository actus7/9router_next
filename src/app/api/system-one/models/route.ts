import { NextResponse } from "next/server";
import { tenantRoute } from "@/server/application/http/tenantRoute";
import { listSystemOneModels } from "@/server/decisions/systemOneModels";

/** The System One models the account's AI Gateway key can use (judges for Fusion combos). */
async function handleGET() {
  return NextResponse.json(await listSystemOneModels());
}

export const GET = tenantRoute(handleGET);
