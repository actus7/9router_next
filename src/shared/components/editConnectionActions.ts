"use client";

export async function testProviderConnection(
  connectionId: string,
  setTestResult: (v: string | null) => void,
  setTesting: (v: boolean) => void,
) {
  setTesting(true); setTestResult(null);
  try {
    const res = await fetch(`/api/providers/${connectionId}/test`, { method: "POST" });
    const data = await res.json();
    setTestResult(data.valid ? "success" : "failed");
  } catch { setTestResult("failed");
  } finally { setTesting(false); }
}

export async function validateProviderKey(params: {
  provider: string; apiKey: string;
  isAzure: boolean; azureData: Record<string, unknown>;
  isCloudflareAi: boolean; cloudflareData: Record<string, unknown>;
  providerRegions: unknown[] | null; regionData: Record<string, unknown> | undefined;
  setValidationResult: (v: string | null) => void;
  setValidating: (v: boolean) => void;
}): Promise<boolean> {
  const { provider, apiKey, isAzure, azureData, isCloudflareAi, cloudflareData, providerRegions, regionData, setValidationResult, setValidating } = params;
  setValidating(true); setValidationResult(null);
  try {
    const res = await fetch("/api/providers/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider, apiKey,
        ...(isAzure ? { providerSpecificData: azureData } : {}),
        ...(isCloudflareAi ? { providerSpecificData: cloudflareData } : {}),
        ...(providerRegions ? { providerSpecificData: regionData } : {}),
      }),
    });
    const data = await res.json();
    const valid = !!data.valid;
    setValidationResult(valid ? "success" : "failed");
    return valid;
  } catch { setValidationResult("failed"); return false;
  } finally { setValidating(false); }
}
