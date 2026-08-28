// Public server API of the LLM gateway — protocol translation utilities.
import "server-only";

export {
  translateRequest,
  translateResponse,
  initTranslators,
} from "@/server/llm-gateway/engine/translator/index";
export { FORMATS } from "@/server/llm-gateway/engine/translator/formats";
export {
  detectFormat,
  getTargetFormat,
} from "@/server/llm-gateway/engine/services/provider";
export { openaiToCommandCodeRequest } from "@/server/llm-gateway/engine/translator/request/openai-to-commandcode";
export { getModelInfo } from "./application/modelResolution";
