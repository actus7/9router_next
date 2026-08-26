import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import UsageClient from "./UsageClient";

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageClient />
    </Suspense>
  );
}
