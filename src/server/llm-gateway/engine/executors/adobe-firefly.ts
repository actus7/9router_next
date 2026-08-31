import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

const FIREFLY_API = PROVIDERS["adobe-firefly"].baseUrl as string;

// Adobe Firefly is image/video generation only (Firefly 3P async APIs) — there
// is no chat/completions surface. Faking chat output (as this executor used
// to, by echoing generated-image URLs as assistant text) misroutes every
// /v1/chat/completions call instead of telling the caller to use the real
// image/video endpoints.
export class AdobeFireflyExecutor extends BaseExecutor {
  constructor() {
    super("adobe-firefly", PROVIDERS["adobe-firefly"]);
  }

  async execute({ body }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const errResp = new Response(JSON.stringify({
      error: {
        message: "adobe-firefly is a media-generation provider and does not support chat completions. " +
          "Use POST /v1/images/generations (e.g. model \"adobe-firefly/firefly-image\") " +
          "or POST /v1/videos/generations (e.g. model \"adobe-firefly/firefly-video\").",
        type: "invalid_request",
      },
    }), { status: 400, headers: { "Content-Type": "application/json" } });
    return { response: errResp, url: FIREFLY_API, headers: {} as Record<string, string>, transformedBody: body };
  }
}

export default AdobeFireflyExecutor;
