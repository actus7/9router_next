import { Suspense } from "react";
import { getSettings, getDatabaseInfo } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import ProfileClient from "./ProfileClient";

async function ProfileContent() {
  await assertRequestRuntime();
  const [settings, dbInfo] = await Promise.all([
    getSettings(),
    getDatabaseInfo()
  ]);
  return <ProfileClient initialSettings={settings} initialDbInfo={dbInfo} />;
}

export default function ProfilePage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ProfileContent /></Suspense>;
}
