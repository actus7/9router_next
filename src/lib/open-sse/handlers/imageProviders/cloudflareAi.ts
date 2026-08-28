import { nowSec, urlToBase64 } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

const BASE_URL = (PROVIDER_MEDIA["cloudflare-ai"]?.imageConfig as Record<string, unknown>)?.baseUrl as string;

const MULTIPART_MODELS = new Set([
  "@cf/black-forest-labs/flux-2-dev",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-klein-9b",
]);

const OPTIONAL_FIELDS = [
  "negative_prompt",
  "guidance",
  "seed",
  "num_steps",
  "steps",
  "strength",
];

function sizeToDimensions(size: unknown): Record<string, number> {
  const match = /^(\d+)x(\d+)$/.exec(String(size || ""));
  if (!match) return {};
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function getDimensions(body: Record<string, unknown>): Record<string, number> {
  return {
    ...sizeToDimensions(body.size),
    ...(Number.isFinite(Number(body.width)) ? { width: Number(body.width) } : {}),
    ...(Number.isFinite(Number(body.height)) ? { height: Number(body.height) } : {}),
  };
}

async function resolveImageInput(value: unknown): Promise<{ bytes: number[] | unknown; b64: string } | null> {
  if (Array.isArray(value)) {
    return { bytes: value, b64: Buffer.from(value).toString("base64") };
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    const b64 = await urlToBase64(trimmed);
    return { bytes: base64ToBytes(b64), b64 };
  }
  const match = /^data:image\/[^;]+;base64,(.+)$/i.exec(trimmed);
  const b64 = match ? match[1] : trimmed;
  return { bytes: base64ToBytes(b64), b64 };
}

function base64ToBytes(value: string): number[] | string {
  try {
    return Array.from(Buffer.from(value, "base64"));
  } catch {
    return value;
  }
}

function addOptionalFields(target: Record<string, unknown> | FormData, body: Record<string, unknown>, append: (t: Record<string, unknown> | FormData, k: string, v: unknown) => void): void {
  for (const key of OPTIONAL_FIELDS) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    append(target, key, value);
  }
}

async function buildJsonBody(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const req: Record<string, unknown> = { prompt: body.prompt, ...getDimensions(body) };

  addOptionalFields(req, body, (target, key, value) => {
    (target as Record<string, unknown>)[key] = value;
  });

  const imageData = await resolveImageInput(body.image);
  if (imageData) {
    req.image_b64 = imageData.b64;
    req.image = imageData.bytes;
  }

  const maskData = await resolveImageInput(body.mask_image || body.maskImage || body.mask);
  if (maskData) {
    req.mask_b64 = maskData.b64;
    req.mask = maskData.bytes;
    req.mask_image = maskData.bytes;
  }

  return req;
}

function buildMultipartBody(body: Record<string, unknown>): FormData {
  const form = new FormData();
  form.append("prompt", body.prompt as string);

  const dimensions = getDimensions(body);
  for (const [key, value] of Object.entries(dimensions)) {
    form.append(key, String(value));
  }

  addOptionalFields(form, body, (target, key, value) => {
    (target as FormData).append(key, String(value));
  });

  return form;
}

function imageItemFromString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  if (/^data:image\/[^;]+;base64,/i.test(value)) {
    return { b64_json: value.replace(/^data:image\/[^;]+;base64,/i, "") };
  }
  if (/^https?:\/\//i.test(value)) return { url: value };
  return { b64_json: value };
}

function normalizeCloudflareResponse(responseBody: Record<string, unknown>): Record<string, unknown> {
  if (responseBody?.created && Array.isArray(responseBody?.data)) return responseBody;

  const result = (responseBody?.result ?? responseBody) as Record<string, unknown>;
  const queuedResponse = Array.isArray(result?.responses)
    ? (result.responses as Array<Record<string, unknown>>).find((item) => item?.success !== false)?.result as Record<string, unknown>
    : null;
  if (queuedResponse) return normalizeCloudflareResponse(queuedResponse);

  const image =
    (typeof result === "string" ? result : null) ||
    result?.image as string ||
    (result?.data as Array<Record<string, unknown>>)?.[0]?.b64_json as string ||
    (result?.data as Array<Record<string, unknown>>)?.[0]?.url as string;

  const item = imageItemFromString(image);
  return {
    created: nowSec(),
    data: item ? [item] : [],
  };
}

export default {
  buildUrl: (model: string, creds: Record<string, unknown>): string => {
    const accountId = (creds?.providerSpecificData as Record<string, unknown>)?.accountId as string;
    if (!accountId) throw new Error("cloudflare-ai requires accountId in providerSpecificData");
    return `${BASE_URL}/${accountId}/ai/run/${model}`;
  },

  buildHeaders: (creds: Record<string, unknown>, requestBody: unknown): Record<string, string> => {
    const headers: Record<string, string> = {};
    const isMultipart = typeof FormData !== "undefined" && requestBody instanceof FormData;
    if (!isMultipart) {
      headers["Content-Type"] = "application/json";
    }
    const key = (creds?.apiKey || creds?.accessToken) as string;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },

  buildBody: async (model: string, body: Record<string, unknown>): Promise<unknown> => (
    MULTIPART_MODELS.has(model)
      ? buildMultipartBody(body)
      : await buildJsonBody(body)
  ),

  async parseResponse(response: Response): Promise<Record<string, unknown>> {
    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (contentType.startsWith("image/")) {
      const buf = await response.arrayBuffer();
      return {
        created: nowSec(),
        data: [{ b64_json: Buffer.from(buf).toString("base64") }],
      };
    }

    const json = await response.json() as Record<string, unknown>;
    return normalizeCloudflareResponse(json);
  },

  normalize: normalizeCloudflareResponse,
};
