import { Suspense } from "react";
import { getSettings } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import ProfileClient from "./ProfileClient";
import { withTenantPage } from "@/server/application/http/withTenantPage";
import { readAccentColorAttribute } from "@/app/accentColor.server";

async function ProfileContent() {
  return withTenantPage(async () => {
    await assertRequestRuntime();
    // O RootShell já lê este cookie para o `data-accent` do <html>; entregá-lo
    // ao cliente é o que faz o seletor renderizar a bolinha certa no SSR, em vez
    // de marcar "default" e pular de lugar na hidratação.
    const [settings, accent] = await Promise.all([getSettings(), readAccentColorAttribute()]);
    return <ProfileClient initialSettings={settings} initialAccent={accent ?? "default"} />;
  });
}

export default function ProfilePage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ProfileContent /></Suspense>;
}
