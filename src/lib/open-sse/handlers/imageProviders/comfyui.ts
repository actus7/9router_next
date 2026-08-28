// ComfyUI — local, noAuth (placeholder; full graph workflow not implemented)
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["comfyui"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

export default {
  noAuth: true,
  buildUrl: (): string => BASE_URL,
  buildHeaders: (): Record<string, string> => ({ "Content-Type": "application/json" }),
  buildBody: (_model: string, body: Record<string, unknown>): Record<string, unknown> => ({ prompt: body.prompt }),
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => responseBody,
};
