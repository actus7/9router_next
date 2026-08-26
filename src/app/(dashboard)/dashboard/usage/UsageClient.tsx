"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton } from "@/shared/components";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

export default function UsageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value: string) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="inline-flex w-full sm:w-auto">
          <TabsList variant="default" className="rounded-[10px] bg-surface-2 p-1">
            <TabsTrigger value="overview" className="shrink-0 flex-none px-4 rounded-[8px] font-medium transition-all h-9 text-sm data-active:bg-surface data-active:text-text-main data-active:shadow-sm text-text-muted hover:text-text-main">Overview</TabsTrigger>
            <TabsTrigger value="details" className="shrink-0 flex-none px-4 rounded-[8px] font-medium transition-all h-9 text-sm data-active:bg-surface data-active:text-text-main data-active:shadow-sm text-text-muted hover:text-text-main">Details</TabsTrigger>
          </TabsList>
        </Tabs>
        {activeTab === "overview" && (
          <Tabs value={period} onValueChange={setPeriod} className="inline-flex w-full sm:w-auto">
            <TabsList variant="default" className="rounded-[10px] bg-surface-2 p-1">
              {PERIODS.map((p) => (
                <TabsTrigger key={p.value} value={p.value} className="shrink-0 flex-none px-4 rounded-[8px] font-medium transition-all h-7 text-xs data-active:bg-surface data-active:text-text-main data-active:shadow-sm text-text-muted hover:text-text-main">{p.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
