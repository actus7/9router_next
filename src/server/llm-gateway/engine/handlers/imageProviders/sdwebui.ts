// SD WebUI (AUTOMATIC1111) — local, noAuth
import { nowSec } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["sdwebui"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

export default {
  noAuth: true,
  buildUrl: (): string => BASE_URL,
  buildHeaders: (): Record<string, string> => ({ "Content-Type": "application/json" }),
  buildBody: (_model: string, body: Record<string, unknown>): Record<string, unknown> => {
    const { prompt, n = 1, size = "1024x1024" } = body;
    const [width, height] = (size as string).split("x").map(Number);
    return { prompt, width: width || 512, height: height || 512, steps: 20, batch_size: n };
  },
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => {
    const images = Array.isArray(responseBody.images) ? (responseBody.images as string[]).map((img: string) => ({ b64_json: img })) : [];
    return { created: nowSec(), data: images };
  },
};
