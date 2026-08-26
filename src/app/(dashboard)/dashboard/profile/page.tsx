import { Suspense } from "react";
import { getSettings, getDatabaseInfo } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage() {
  const [settings, dbInfo] = await Promise.all([
    getSettings(),
    getDatabaseInfo()
  ]);
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}>
      <ProfileClient initialSettings={settings} initialDbInfo={dbInfo} />
    </Suspense>
  );
}
