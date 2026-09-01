import { DefaultExecutor } from "./default";
import { resolveXiaomiTokenplanBaseUrl } from "../config/providers";
import type { Credentials } from "../services/types";
// import { getModelTargetFormat } from "../config/providerModels";
// import { FORMATS } from "../translator/formats";

export class XiaomiTokenplanExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-tokenplan");
  }

  // Token Plan keys are region-specific. Route per sourceFormat-matched transport:
  // claude → Anthropic /anthropic/v1/messages, openai → /chat/completions.
  buildUrl(model: string, stream: boolean, _urlIndex = 0, credentials: Credentials | null = null) {
    const baseUrl = resolveXiaomiTokenplanBaseUrl(credentials ?? undefined);
    if ((credentials?.runtimeTransport as Record<string, unknown>)?.format === "claude") {
      return `${baseUrl.replace(/\/v1\/?$/, "")}/anthropic/v1/messages`;
    }
    return `${baseUrl}/chat/completions`;
  }
}
