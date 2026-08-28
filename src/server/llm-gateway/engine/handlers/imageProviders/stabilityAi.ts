// Stability AI v2 — sync, returns { image: "<b64>" }
import { nowSec, sizeToAspectRatio } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["stability-ai"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

// Map model id → endpoint segment
function modelToEndpoint(model: string): string {
  if (model.includes("ultra")) return "ultra";
  if (model.includes("sd3")) return "sd3";
  return "core";
}

export default {
  buildUrl: (model: string): string => `${BASE_URL}/${modelToEndpoint(model)}`,
  buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
    const key = (creds?.apiKey || creds?.accessToken) as string;
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "Accept": "application/json",
    };
  },
  buildBody: (model: string, body: Record<string, unknown>): Record<string, unknown> => {
    const req: Record<string, unknown> = { prompt: body.prompt, output_format: ((body.output_format as string) || "png").toLowerCase() };
    if (body.size) req.aspect_ratio = sizeToAspectRatio(body.size as string);
    if (body.style) req.style_preset = body.style;
    if (model.includes("sd3")) req.model = model;
    return req;
  },
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => {
    if (responseBody.image) return { created: nowSec(), data: [{ b64_json: responseBody.image }] };
    return { created: nowSec(), data: [] };
  },
};
