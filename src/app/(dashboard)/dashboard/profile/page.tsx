import { Suspense } from "react";
import { getSettings } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import ProfileClient from "./ProfileClient";
import { withTenantPage } from "@/server/application/http/withTenantPage";

async function ProfileContent() {
  return withTenantPage(async () => {
    await assertRequestRuntime();
    const settings = await getSettings();
    return <ProfileClient initialSettings={settings} />;
  });
}

export default function ProfilePage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ProfileContent /></Suspense>;
}
