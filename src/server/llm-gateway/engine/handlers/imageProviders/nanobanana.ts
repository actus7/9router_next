// NanoBanana API — async submit + poll record-info
import { sleep, nowSec, sizeToAspectRatio, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const IMG_CFG = (PROVIDER_MEDIA["nanobanana"]?.imageConfig || {}) as Record<string, unknown>;
const SUBMIT_URL = IMG_CFG.baseUrl as string;
const POLL_BASE = IMG_CFG.pollUrl as string;

export default {
  async: true,
  buildUrl: (): string => SUBMIT_URL,
  buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = (creds?.apiKey || creds?.accessToken) as string;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (_model: string, body: Record<string, unknown>): Record<string, unknown> => {
    const ratio = sizeToAspectRatio(body.size as string);
    const isEdit = !!(body.image || (Array.isArray(body.images) && body.images.length));
    const req: Record<string, unknown> = {
      prompt: body.prompt,
      type: isEdit ? "IMAGETOIAMGE" : "TEXTTOIAMGE",
      numImages: body.n || 1,
      image_size: ratio,
      // API requires callBackUrl; we poll instead so a dummy URL is fine.
      callBackUrl: "https://localhost/callback",
    };
    if (isEdit) {
      const urls = Array.isArray(body.images) ? (body.images as unknown[]).filter(Boolean) : [];
      if (body.image) urls.push(body.image);
      req.imageUrls = urls;
    }
    return req;
  },
  // Async: parse submit → poll until SUCCESS, return raw poll data
  async parseResponse(response: Response, { headers }: Record<string, unknown>): Promise<Record<string, unknown>> {
    const submitData = await response.json() as Record<string, unknown>;
    if (submitData.code !== 200) throw new Error((submitData.msg as string) || "NanoBanana submit failed");
    const taskId = (submitData.data as Record<string, unknown>)?.taskId as string;
    if (!taskId) throw new Error("NanoBanana: no taskId returned");
    const pollUrl = `${POLL_BASE}?taskId=${encodeURIComponent(taskId)}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(pollUrl, { headers: headers as Record<string, string> });
      if (!r.ok) throw new Error(`NanoBanana status ${r.status}`);
      const s = await r.json() as Record<string, unknown>;
      const flag = (s.data as Record<string, unknown>)?.successFlag as number;
      if (flag === 1) return s.data as Record<string, unknown>;
      if (flag === 2 || flag === 3) throw new Error(((s.data as Record<string, unknown>)?.errorMessage as string) || "NanoBanana generation failed");
    }
    throw new Error("NanoBanana polling timeout");
  },
  normalize: (responseBody: Record<string, unknown>, prompt?: string): Record<string, unknown> => {
    const url = ((responseBody.response as Record<string, unknown>)?.resultImageUrl || (responseBody.response as Record<string, unknown>)?.originImageUrl) as string;
    if (url) return { created: nowSec(), data: [{ url, revised_prompt: prompt }] };
    return { created: nowSec(), data: [] };
  },
};
