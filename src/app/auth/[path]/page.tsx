import { Suspense } from "react";

import { AuthView } from "@neondatabase/auth/react/ui";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

/**
 * Every auth screen lives at /auth/<path>: sign-in, sign-up, forgot-password,
 * reset-password, callback, sign-out. `AuthView` picks the form from the path,
 * so there is one route instead of six.
 */
async function AuthForm({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  return <AuthView path={path} />;
}

export default function AuthPage({ params }: PageProps<"/auth/[path]">) {
  // `params` is request data, and Cache Components wants request data read
  // inside a boundary so the shell around it can still be prerendered —
  // reading it at the top of the page makes the whole route blocking.
  return (
    <>
      <Suspense fallback={<div className="h-96 w-full max-w-sm animate-pulse rounded-lg bg-muted" />}>
        <AuthForm params={params} />
      </Suspense>
      <MetadataIsDynamic />
    </>
  );
}
