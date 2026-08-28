// HuggingFace Inference API — returns binary image
import { nowSec } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["huggingface"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

export default {
  buildUrl: (model: string): string => `${BASE_URL}/${model}`,
  buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = (creds?.apiKey || creds?.accessToken) as string;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (_model: string, body: Record<string, unknown>): Record<string, unknown> => ({ inputs: body.prompt }),
  // HF returns raw image bytes — convert to b64_json
  async parseResponse(response: Response): Promise<Record<string, unknown>> {
    const buf = await response.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { created: nowSec(), data: [{ b64_json: base64 }] };
  },
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => responseBody,
};
