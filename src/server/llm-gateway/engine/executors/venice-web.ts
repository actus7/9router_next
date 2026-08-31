import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { executePassThroughWeb } from "./webShared";
import type { PassThroughWebConfig } from "./webShared";
import type { Credentials, Logger } from "../services/types";

const config: PassThroughWebConfig = {
  providerName: "Venice",
  logTag: "VENICE-WEB",
  apiUrl: PROVIDERS["venice-web"].baseUrl as string,
  origin: "https://venice.ai",
  referer: "https://venice.ai/",
  defaultModel: "venice-default",
  authErrorMessage: "Venice auth failed — session cookie may be expired. Re-paste your cookie from venice.ai.",
  buildAuthHeaders(credentials: Credentials): Record<string, string> {
    const h: Record<string, string> = {};
    if (credentials.apiKey) h.Cookie = credentials.apiKey;
    return h;
  },
};

export class VeniceWebExecutor extends BaseExecutor {
  constructor() {
    super("venice-web", PROVIDERS["venice-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    return executePassThroughWeb(config, { model, body, stream, credentials, signal, log });
  }
}

export default VeniceWebExecutor;
