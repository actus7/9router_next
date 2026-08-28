import { DefaultExecutor } from "./default";
import { resolveOllamaLocalHost } from "../config/providers";
import type { Credentials } from "../services/types";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials: Credentials | null = null) {
    return `${resolveOllamaLocalHost(credentials ?? undefined)}/api/chat`;
  }
}

export default OllamaLocalExecutor;
