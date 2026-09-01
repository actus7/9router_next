"use client";


export async function validateCompatibleNode(
  baseUrl: string,
  apiKey: string,
  isAnthropic: boolean,
  modelId?: string,
): Promise<"success" | "failed"> {
  try {
    const res = await fetch("/api/provider-nodes/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl,
        apiKey,
        type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
        modelId: modelId?.trim() || undefined,
      }),
    });
    const data = await res.json();
    return data.valid ? "success" : "failed";
  } catch {
    return "failed";
  }
}

export async function submitCompatibleNode(
  formData: { name: string; prefix: string; apiType: string; baseUrl: string },
  isAnthropic: boolean,
  onSave: (formData: Record<string, string>) => Promise<void>,
): Promise<void> {
  if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
  const payload: Record<string, string> = {
    name: formData.name,
    prefix: formData.prefix,
    baseUrl: formData.baseUrl,
  };
  if (!isAnthropic) payload.apiType = formData.apiType;
  await onSave(payload);
}
