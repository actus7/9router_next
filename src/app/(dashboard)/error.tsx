"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <div className="flex items-center justify-center size-14 rounded-full bg-danger/10 text-danger">
          <AlertCircle className="size-7" />
        </div>
        <h2 className="text-lg font-semibold text-text-main">Something went wrong</h2>
        <p className="text-sm text-text-muted">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button
          onClick={retry}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
