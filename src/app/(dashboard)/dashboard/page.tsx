import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import UsageClient from "./usage/UsageClient";

export default function DashboardPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageClient />
    </Suspense>
  );
}
