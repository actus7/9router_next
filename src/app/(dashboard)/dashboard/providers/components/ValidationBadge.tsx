"use client";

import { Badge } from "@/components/ui/badge";

interface ValidationResult {
  valid: boolean;
  error?: string;
  method?: string;
}

export default function ValidationBadge({ result }: { result: ValidationResult | null }) {
  if (!result) return null;
  const { valid, error, method } = result;
  if (valid) {
    return (
      <>
        <Badge variant="default" className="bg-success text-success-foreground dark:text-success-foreground">Valid</Badge>
        {method === "chat" && <span className="text-sm text-text-muted">(via inference test)</span>}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="destructive">Invalid</Badge>
      {error && <span className="text-sm text-destructive-foreground">{error}</span>}
    </div>
  );
}
