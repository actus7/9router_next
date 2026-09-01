"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Info, Loader2 } from "lucide-react";

interface CallbackData {
  code: string | null;
  token: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
  fullUrl: string;
}

function CallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    const code = searchParams.get("code");
    const token = searchParams.get("token");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");
    const callbackData: CallbackData = { code, token, state, error, errorDescription, fullUrl: window.location.href };
    const expectedOrigins = [window.location.origin, "http://localhost:1455"];

    if (window.opener) {
      for (const origin of expectedOrigins) {
        try {
          (window.opener as Window).postMessage({ type: "oauth_callback", data: callbackData }, origin);
        } catch (postMessageError) {
          console.error("postMessage failed:", postMessageError);
        }
      }
    }
    try {
      const channel = new BroadcastChannel("oauth_callback");
      channel.postMessage(callbackData);
      channel.close();
    } catch (broadcastError) {
      console.error("BroadcastChannel failed:", broadcastError);
    }
    try {
      localStorage.setItem("oauth_callback", JSON.stringify({ ...callbackData, timestamp: Date.now() }));
    } catch (storageError) {
      console.error("localStorage failed:", storageError);
    }

    if (!(code || token || error)) {
      setTimeout(() => setStatus("manual"), 0);
      return;
    }
    setStatus("success");
    setTimeout(() => {
      window.close();
      setTimeout(() => setStatus("done"), 500);
    }, 1500);
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center p-8 max-w-md">
        {status === "processing" && <>
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center"><Loader2 className="size-4" /></div>
          <h1 className="text-xl font-semibold mb-2">Processing...</h1>
          <p className="text-text-muted">Please wait while we complete the authorization.</p>
        </>}
        {(status === "success" || status === "done") && <>
          <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"><CheckCircle2 className="size-4" /></div>
          <h1 className="text-xl font-semibold mb-2">Authorization Successful!</h1>
          <p className="text-text-muted">{status === "success" ? "This window will close automatically..." : "You can close this tab now."}</p>
        </>}
        {status === "manual" && <>
          <div className="size-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center"><Info className="size-4" /></div>
          <h1 className="text-xl font-semibold mb-2">Copy This URL</h1>
          <p className="text-text-muted mb-4">Please copy the URL from the address bar and paste it in the application.</p>
          <div className="bg-surface border border-border rounded-lg p-3 text-left">
            <code className="text-xs break-all">{typeof window !== "undefined" ? window.location.href : ""}</code>
          </div>
        </>}
      </div>
    </div>
  );
}

/**
 * OAuth Callback Page
 * Receives callback from OAuth providers and sends data back via multiple methods
 */
export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center p-8">
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="size-4" />
          </div>
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
