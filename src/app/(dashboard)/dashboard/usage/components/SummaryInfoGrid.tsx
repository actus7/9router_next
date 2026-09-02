"use client";

import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { RequestDetail } from "./types";
import { getInputTokens, getCachedTokens, getCacheCreationTokens } from "./tokenUtils";

interface Props {
  detail: RequestDetail;
  providerName: string;
}

export default function SummaryInfoGrid({ detail, providerName }: Props) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      <div>
        <span className="text-text-muted">ID:</span>{" "}
        <span className="break-all font-mono text-text-main">{detail.id}</span>
      </div>
      <div>
        <span className="text-text-muted">{translate("DateTime")}:</span>{" "}
        <span className="text-text-main">{new Date(detail.timestamp).toLocaleString()}</span>
      </div>
      <div>
        <span className="text-text-muted">{translate("Provider:")}</span>{" "}
        <span className="text-text-main font-medium">{providerName}</span>
      </div>
      <div>
        <span className="text-text-muted">{translate("Model:")}</span>{" "}
        <span className="text-text-main font-mono">{detail.model}</span>
      </div>
      <div>
        <span className="text-text-muted">{translate("Status:")}</span>{" "}
        <span className={cn(
          "font-medium",
          detail.status === "success" ? "text-success" : "text-destructive"
        )}>
          {detail.status}
        </span>
      </div>
      <div>
        <span className="text-text-muted">{translate("Latency:")}</span>{" "}
        <span className="text-text-main font-mono">
          TTFT {detail.latency?.ttft || 0}ms / Total {detail.latency?.total || 0}ms
        </span>
      </div>
      <div>
        <span className="text-text-muted">{translate("Input Tokens:")}</span>{" "}
        <span className="text-text-main font-mono">
          {getInputTokens(detail.tokens).toLocaleString()}
        </span>
      </div>
      {getCachedTokens(detail.tokens) > 0 && (
        <div>
          <span className="text-text-muted">{translate("Cached Tokens:")}</span>{" "}
          <span className="text-text-main font-mono">
            {getCachedTokens(detail.tokens).toLocaleString()}
          </span>
        </div>
      )}
      {getCacheCreationTokens(detail.tokens) > 0 && (
        <div>
          <span className="text-text-muted">{translate("Cache Creation:")}</span>{" "}
          <span className="text-text-main font-mono">
            {getCacheCreationTokens(detail.tokens).toLocaleString()}
          </span>
        </div>
      )}
      <div>
        <span className="text-text-muted">{translate("Output Tokens:")}</span>{" "}
        <span className="text-text-main font-mono">
          {detail.tokens?.completion_tokens?.toLocaleString() || 0}
        </span>
      </div>
    </div>
  );
}
