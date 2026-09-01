"use client";

import { translate } from "@/i18n/runtime";

interface BulkImportResult {
  success: number;
  failed: number;
  results?: Array<{ ok: boolean; index: number; error?: string }>;
}

export function normalizeToArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.accounts)) return obj.accounts;
    return [parsed];
  }
  return null;
}

export async function submitBulkImport(
  jsonText: string,
): Promise<{ result?: BulkImportResult; error?: string }> {
  const trimmed = jsonText.trim();
  if (!trimmed) return { error: "" };

  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); }
  catch (err: unknown) { return { error: `${translate("Invalid JSON")}: ${err instanceof Error ? err.message : String(err)}` }; }

  const accounts = normalizeToArray(parsed);
  if (!accounts || accounts.length === 0) return { error: translate("No accounts found in input") || "" };

  try {
    const res = await fetch("/api/oauth/codex/bulk-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts }),
    });
    const data: BulkImportResult = await res.json();
    if (!res.ok) return { error: (data as unknown as { error?: string })?.error || `Request failed: ${res.status}` };
    return { result: data };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : (translate("Request failed") || "") };
  }
}
