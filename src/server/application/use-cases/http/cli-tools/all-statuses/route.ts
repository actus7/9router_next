import { NextRequest, NextResponse } from "next/server";
import { serializeHttpError } from "@/server/application/http/httpError";
import { GET as claudeGet } from "@/server/application/use-cases/http/cli-tools/claude-settings/route";
import { GET as codexGet } from "@/server/application/use-cases/http/cli-tools/codex-settings/route";
import { GET as opencodeGet } from "@/server/application/use-cases/http/cli-tools/opencode-settings/route";
import { GET as droidGet } from "@/server/application/use-cases/http/cli-tools/droid-settings/route";
import { GET as openclawGet } from "@/server/application/use-cases/http/cli-tools/openclaw-settings/route";
import { GET as hermesGet } from "@/server/application/use-cases/http/cli-tools/hermes-settings/route";
import { GET as coworkGet } from "@/server/application/use-cases/http/cli-tools/cowork-settings/route";
import { GET as copilotGet } from "@/server/application/use-cases/http/cli-tools/copilot-settings/route";
import { GET as clineGet } from "@/server/application/use-cases/http/cli-tools/cline-settings/route";
import { GET as kiloGet } from "@/server/application/use-cases/http/cli-tools/kilo-settings/route";
import { GET as deepseekTuiGet } from "@/server/application/use-cases/http/cli-tools/deepseek-tui-settings/route";
import { GET as jcodeGet } from "@/server/application/use-cases/http/cli-tools/jcode-settings/route";
import { GET as grokBuildGet } from "@/server/application/use-cases/http/cli-tools/grok-build-settings/route";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { GET as devinGet } from "@/server/application/use-cases/http/cli-tools/devin-settings/route";

const STATUS_GETTERS = {
  claude: claudeGet,
  codex: codexGet,
  opencode: opencodeGet,
  droid: droidGet,
  openclaw: openclawGet,
  hermes: hermesGet,
  cowork: coworkGet,
  copilot: copilotGet,
  cline: clineGet,
  kilo: kiloGet,
  "deepseek-tui": deepseekTuiGet,
  jcode: jcodeGet,
  "grok-build": grokBuildGet,
  devin: devinGet,
};

export async function GET() {
  await assertRequestRuntime();
  const statusRequest = new NextRequest("http://localhost/api/cli-tools/all-statuses");
  try {
    const entries = await Promise.all(
      Object.entries(STATUS_GETTERS).map(async ([toolId, getter]) => {
        try {
          const res = await (getter as (request: NextRequest) => Promise<Response>)(statusRequest);
          const data = await res.json();
          return [toolId, data] as const;
        } catch (error) {
          // One broken tool must not blank the whole page, but it must not vanish
          // either: `null` is indistinguishable from "not installed" in the UI.
          console.error(`Error reading cli-tools status for ${toolId}:`, error);
          return [toolId, null] as const;
        }
      }),
    );
    return NextResponse.json(Object.fromEntries(entries));
  } catch (error) {
    console.error("Error in cli-tools/all-statuses GET:", error);
    return serializeHttpError(error, "Failed to fetch CLI tool statuses");
  }
}
