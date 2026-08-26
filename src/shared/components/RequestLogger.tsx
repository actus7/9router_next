"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export default function RequestLogger() {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Request Logs</h2>
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer">
            <span>Auto Refresh (3s)</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${autoRefresh ? "bg-primary" : "bg-bg-subtle border border-border"
                }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoRefresh ? "translate-x-5" : "translate-x-1"
                  }`}
              />
            </div>
          </Label>
        </div>
      </div>

      <Card className="overflow-hidden bg-surface-2">
        <CardContent>
          <div className="p-0 max-h-[600px] overflow-y-auto font-mono text-xs">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">No logs recorded yet.</div>
          ) : (
            <Table className="whitespace-nowrap">
              <TableHeader className="sticky top-0 bg-bg-subtle z-10">
                <TableRow>
                  <TableHead className="px-3 py-2 border-r border-border">DateTime</TableHead>
                  <TableHead className="px-3 py-2 border-r border-border">Model</TableHead>
                  <TableHead className="px-3 py-2 border-r border-border">Provider</TableHead>
                  <TableHead className="px-3 py-2 border-r border-border">Account</TableHead>
                  <TableHead className="px-3 py-2 border-r border-border">In</TableHead>
                  <TableHead className="px-3 py-2 border-r border-border">Out</TableHead>
                  <TableHead className="px-3 py-2">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log, i) => {
                  const parts = log.split(" | ");
                  if (parts.length < 7) return null;

                  const status = parts[6];
                  const isPending = status.includes("PENDING");
                  const isFailed = status.includes("FAILED");
                  const isSuccess = status.includes("OK");

                  return (
                    <TableRow key={i} className={`hover:bg-primary/5 ${isPending ? 'bg-primary/5' : ''}`}>
                      <TableCell className="px-3 py-1.5 border-r border-border text-text-muted">{parts[0]}</TableCell>
                      <TableCell className="px-3 py-1.5 border-r border-border font-medium">{parts[1]}</TableCell>
                      <TableCell className="px-3 py-1.5 border-r border-border">
                        <span className="px-1.5 py-0.5 rounded bg-bg-subtle border border-border text-[10px] uppercase font-bold">
                          {parts[2]}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-1.5 border-r border-border truncate max-w-[150px]" title={parts[3]}>{parts[3]}</TableCell>
                      <TableCell className="px-3 py-1.5 border-r border-border text-right text-primary">{parts[4]}</TableCell>
                      <TableCell className="px-3 py-1.5 border-r border-border text-right text-success">{parts[5]}</TableCell>
                      <TableCell className={`px-3 py-1.5 font-bold ${isSuccess ? 'text-success' :
                          isFailed ? 'text-error' :
                            'text-primary animate-pulse'
                        }`}>
                        {status}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        </CardContent>
      </Card>
      <div className="text-[10px] text-text-muted italic">
        Logs are loaded from the request history database.
      </div>
    </div>
  );
}
