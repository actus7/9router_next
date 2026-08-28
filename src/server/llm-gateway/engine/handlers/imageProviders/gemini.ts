// Google Gemini adapter (Nano Banana models)
import { nowSec } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["gemini"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

export default {
  buildUrl: (model: string, creds: Record<string, unknown>): string => {
    const apiKey = (creds?.apiKey || creds?.accessToken) as string;
    const modelId = model.replace(/^models\//, "");
    return `${BASE_URL}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
  },
  buildHeaders: (): Record<string, string> => ({ "Content-Type": "application/json" }),
  buildBody: (_model: string, body: Record<string, unknown>): Record<string, unknown> => ({
    contents: [{ parts: [{ text: body.prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  }),
  normalize: (responseBody: Record<string, unknown>, prompt?: string): Record<string, unknown> => {
    const parts = ((responseBody.candidates as Array<Record<string, unknown>>)?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>> || [];
    const images = parts.filter((p) => (p.inlineData as Record<string, unknown>)?.data).map((p) => ({ b64_json: (p.inlineData as Record<string, unknown>).data }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
