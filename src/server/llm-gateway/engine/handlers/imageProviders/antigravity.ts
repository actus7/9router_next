// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec } from "./_base";
import { getExecutor } from "../../executors/index";

// Convert image input (data URI or raw base64) to Gemini inlineData part
function resolveImageInput(input: unknown): { inlineData: { mimeType: string; data: string } } | null {
  if (!input || typeof input !== "string") return null;
  // data:image/png;base64,... format
  const dataUriMatch = input.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    return { inlineData: { mimeType: dataUriMatch[1], data: dataUriMatch[2] } };
  }
  // Raw base64 string (assume PNG)
  if (/^[A-Za-z0-9+/]/.test(input) && input.length > 100 && !input.startsWith("http")) {
    return { inlineData: { mimeType: "image/png", data: input } };
  }
  return null;
}

export default {
  // Delegate to executor instead of building URL/headers/body manually
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: (): string => "",
  buildHeaders: (): Record<string, string> => ({}),
  buildBody: (): Record<string, unknown> => ({}),

  async executeViaExecutor(model: string, body: Record<string, unknown>, credentials: Record<string, unknown>, log?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const executor = getExecutor("antigravity");
    if (!executor) throw new Error("Antigravity executor not found");

    // Build parts: text prompt + optional input image for editing
    const parts: Array<Record<string, unknown>> = [{ text: body.prompt }];
    const imageInput = body.image || (Array.isArray(body.images) && body.images[0]);
    if (imageInput) {
      const inlineData = resolveImageInput(imageInput);
      if (inlineData) parts.unshift(inlineData as unknown as Record<string, unknown>);
    }

    const chatBody = {
      contents: [{ role: "user", parts }],
    };

    const result = await executor.execute({
      model,
      body: chatBody,
      stream: false,
      credentials,
      log,
    });

    if (!result.response.ok) {
      const text = await result.response.text();
      throw new Error(text || `HTTP ${result.response.status}`);
    }

    return result.response.json();
  },

  normalize: (responseBody: Record<string, unknown>, prompt?: string): Record<string, unknown> => {
    const candidates = (responseBody.candidates || (responseBody.response as Record<string, unknown>)?.candidates || []) as Array<Record<string, unknown>>;
    const parts = ((candidates[0]?.content as Record<string, unknown>)?.parts || []) as Array<Record<string, unknown>>;
    const images = parts.filter((p) => (p.inlineData as Record<string, unknown>)?.data).map((p) => ({
      b64_json: (p.inlineData as Record<string, unknown>).data,
    }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
