"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { Trash2 } from "lucide-react";
import { translate } from "@/i18n/runtime";

const LOG_LEVEL_COLORS: Record<string, string> = {
  LOG: "text-success",
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-destructive",
  DEBUG: "text-purple-400",
};

function colorLine(line: string) {
  // No /g flag: with it, String.match returns whole matches, so match[1] was
  // the *second* bracketed token on the line, never the level — which is why
  // every line rendered in the default green.
  const levelTag = /\[(\w+)\]/.exec(line)?.[1] ?? null;
  const color = LOG_LEVEL_COLORS[levelTag ?? ""] || "text-success";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState<string[]>([]);
  const [, setConnected] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      // A malformed frame, or an "init" with no `logs`, threw inside onmessage
      // and killed the log stream silently — the page just stopped updating.
      let msg: { type?: string; logs?: unknown; line?: unknown; lines?: unknown };
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        console.error("[console-log] bad frame:", err);
        return;
      }
      const cap = (next: string[]) =>
        next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;

      if (msg.type === "init") {
        setLogs(Array.isArray(msg.logs) ? cap(msg.logs as string[]) : []);
      } else if (msg.type === "line") {
        if (typeof msg.line !== "string") return;
        setLogs((prev) => cap([...prev, msg.line as string]));
      } else if (msg.type === "lines") {
        if (!Array.isArray(msg.lines)) return;
        setLogs((prev) => cap([...prev, ...(msg.lines as string[])]));
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="">
      <Card>
        <div className="flex items-center justify-end px-4 pt-3 pb-2">
          <Button size="sm" variant="outline" icon={<Trash2 className="size-4" />} onClick={handleClear}>
            {translate("Clear")}
          </Button>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">{translate("No console logs yet.")}</span>
          ) : (
            <div className="flex flex-col gap-0.5">
              {logs.map((line, i) => (
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}


