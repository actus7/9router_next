// Black Forest Labs (FLUX) — async submit + polling_url
import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["black-forest-labs"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

export default {
  async: true,
  buildUrl: (model: string): string => `${BASE_URL}/${model}`,
  buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
    const key = (creds?.apiKey || creds?.accessToken) as string;
    return { "Content-Type": "application/json", "x-key": key };
  },
  buildBody: (_model: string, body: Record<string, unknown>): Record<string, unknown> => {
    const req: Record<string, unknown> = { prompt: body.prompt };
    if (body.size) {
      const [w, h] = (body.size as string).split("x").map(Number);
      if (w) req.width = w;
      if (h) req.height = h;
    }
    if (body.image) req.image_prompt = body.image;
    return req;
  },
  async parseResponse(response: Response, { headers }: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await response.json() as Record<string, unknown>;
    const pollingUrl = data.polling_url as string;
    if (!pollingUrl) throw new Error("BFL: no polling_url returned");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(pollingUrl, { headers: { "x-key": (headers as Record<string, string>)["x-key"], "Accept": "application/json" } });
      if (!r.ok) throw new Error(`BFL status ${r.status}`);
      const s = await r.json() as Record<string, unknown>;
      if (s.status === "Ready") return s;
      if (s.status === "Error" || s.status === "Failed") throw new Error((s.error as string) || "BFL generation failed");
    }
    throw new Error("BFL polling timeout");
  },
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => {
    const sample = (responseBody.result as Record<string, unknown>)?.sample as string;
    if (sample) return { created: nowSec(), data: [{ url: sample }] };
    return { created: nowSec(), data: [] };
  },
};
