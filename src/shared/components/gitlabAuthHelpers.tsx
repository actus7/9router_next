"use client";

export const GITLAB_COM = "https://gitlab.com";

export function getRedirectUri(): string {
  if (typeof window === "undefined") return "http://localhost/callback";
  return `${window.location.origin}/callback`;
}

export async function submitGitLabPAT(
  pat: string, baseUrl: string,
  onSuccess?: () => void, onClose?: () => void,
  setError?: (v: string | null) => void, setLoading?: (v: boolean) => void,
) {
  if (!pat.trim()) { setError?.("Personal Access Token is required"); return; }
  setLoading?.(true); setError?.(null);
  try {
    const res = await fetch("/api/oauth/gitlab/pat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: pat.trim(), baseUrl: baseUrl.trim() || GITLAB_COM }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Authentication failed");
    onSuccess?.(); onClose?.();
  } catch (err: unknown) { setError?.(err instanceof Error ? err.message : String(err));
  } finally { setLoading?.(false); }
}
