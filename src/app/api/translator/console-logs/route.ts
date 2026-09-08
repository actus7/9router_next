import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { clearConsoleLogs, getConsoleLogs, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

async function handleGET() {
  try {
    const logs = getConsoleLogs();
    return NextResponse.json({ success: true, logs });
  } catch (error: unknown) {
    console.error("Error getting console logs:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

async function handleDELETE() {
  try {
    clearConsoleLogs();
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error clearing console logs:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
export const DELETE = tenantRoute(handleDELETE);
