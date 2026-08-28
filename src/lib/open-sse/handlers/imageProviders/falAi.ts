// Fal.ai — async submit + queue polling
import { sleep, nowSec, sizeToAspectRatio, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["fal-ai"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

export default {
  async: true,
  buildUrl: (model: string): string => `${BASE_URL}/${model}`,
  buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
    const key = (creds?.apiKey || creds?.accessToken) as string;
    return { "Content-Type": "application/json", "Authorization": `Key ${key}` };
  },
  buildBody: (_model: string, body: Record<string, unknown>): Record<string, unknown> => {
    const req: Record<string, unknown> = { prompt: body.prompt, num_images: body.n || 1 };
    if (body.size) req.image_size = sizeToAspectRatio(body.size as string);
    if (body.image) req.image_url = body.image;
    return req;
  },
  async parseResponse(response: Response, { headers }: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { status_url, response_url } = await response.json() as { status_url: string; response_url: string };
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(status_url, { headers: headers as Record<string, string> });
      if (!r.ok) throw new Error(`Fal status ${r.status}`);
      const s = await r.json() as Record<string, unknown>;
      if (s.status === "COMPLETED") {
        const fr = await fetch(response_url, { headers: headers as Record<string, string> });
        return await fr.json() as Record<string, unknown>;
      }
      if (s.status === "FAILED") throw new Error((s.error as string) || "Fal generation failed");
    }
    throw new Error("Fal polling timeout");
  },
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => {
    const images = Array.isArray(responseBody.images)
      ? responseBody.images as Array<Record<string, unknown>>
      : (responseBody.image ? [responseBody.image] : []);
    return { created: nowSec(), data: images.map((img: unknown) => ({ url: (img as Record<string, unknown>)?.url || img })) };
  },
};
