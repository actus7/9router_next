import { NextRequest, NextResponse  } from "next/server";
import { sendToChild, findPlugin } from "@/lib/mcp/stdioSseBridge";


export async function POST(request: NextRequest, { params }: { params: Promise<{ plugin: string }> }) {
  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
  }
  try {
    const body = await request.json();
    sendToChild(plugin, body);
    return new Response(null, { status: 202 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
