// Runway ML — async submit + /tasks/{id} polling
import { sleep, nowSec, sizeToAspectRatio, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["runwayml"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

export default {
  async: true,
  buildUrl: (model: string): string => {
    // Image models (gen4_image*) → text_to_image; video models → image_to_video
    return `${BASE_URL}/${model.includes("image") ? "text_to_image" : "image_to_video"}`;
  },
  buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
    const key = (creds?.apiKey || creds?.accessToken) as string;
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "X-Runway-Version": "2024-11-06",
    };
  },
  buildBody: (model: string, body: Record<string, unknown>): Record<string, unknown> => {
    const isVideo = !model.includes("image");
    const ratio = sizeToAspectRatio(body.size as string);
    if (isVideo) {
      return { promptText: body.prompt, model, ratio, duration: 5, ...(body.image ? { promptImage: body.image } : {}) };
    }
    return { promptText: body.prompt, model, ratio, ...(body.image ? { referenceImages: [{ uri: body.image }] } : {}) };
  },
  async parseResponse(response: Response, { headers }: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { id } = await response.json() as { id: string };
    if (!id) throw new Error("Runway: no task id returned");
    const taskUrl = `${BASE_URL}/tasks/${id}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(taskUrl, { headers: headers as Record<string, string> });
      if (!r.ok) throw new Error(`Runway status ${r.status}`);
      const s = await r.json() as Record<string, unknown>;
      if (s.status === "SUCCEEDED") return s;
      if (s.status === "FAILED" || s.status === "CANCELLED") throw new Error((s.failure as string) || "Runway task failed");
    }
    throw new Error("Runway polling timeout");
  },
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => {
    const outputs = Array.isArray(responseBody.output) ? responseBody.output as string[] : [];
    return { created: nowSec(), data: outputs.map((url: string) => ({ url })) };
  },
};
