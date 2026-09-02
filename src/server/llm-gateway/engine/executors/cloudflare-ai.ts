import { DefaultExecutor } from "./default";

const GLM_47_FLASH = "@cf/zai-org/glm-4.7-flash";
const GLM_47_FLASH_CONNECT_TIMEOUT_MS = 200_000;

/**
 * Workers AI is OpenAI-compatible except that GLM 4.7 Flash can spend a long
 * time reasoning before it sends response headers. Keep the normal timeout for
 * every other model, while preserving this model's documented first-byte grace.
 */
export class CloudflareAIExecutor extends DefaultExecutor {
  constructor() {
    super("cloudflare-ai");
  }

  override getTimeoutMs(model: string) {
    const defaultTimeout = super.getTimeoutMs(model);
    return model === GLM_47_FLASH
      ? Math.max(defaultTimeout, GLM_47_FLASH_CONNECT_TIMEOUT_MS)
      : defaultTimeout;
  }
}
