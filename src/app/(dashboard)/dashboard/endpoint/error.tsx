"use client";

import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export default function EndpointError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold text-text-main">Failed to load endpoint settings</h2>
      <p className="max-w-md text-sm text-text-muted">{error.message || "An unexpected error occurred."}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
