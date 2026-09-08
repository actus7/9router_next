"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NeonAuthUIProvider } from "@neondatabase/auth/react/ui";

import { authClient } from "@/lib/auth/client";

/**
 * Sign-in, sign-up and password recovery.
 *
 * The forms come from Neon's own UI package rather than being rebuilt here:
 * they already cover email verification, password reset, OAuth callbacks and
 * the error states each of those fails in, and every one of those is a place
 * where a hand-rolled form quietly gets something wrong.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <NeonAuthUIProvider
      authClient={authClient}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => router.refresh()}
      Link={Link}
    >
      {/* The app's i18n runtime rewrites text nodes in the DOM after the server
          HTML lands. On these screens that produced "Email" from the server and
          "E-mail" from the translator, which React reports as a hydration
          mismatch and then discards the whole tree. Neon's UI ships its own
          localization, so this subtree opts out of ours. */}
      <main data-i18n-skip="true" className="flex min-h-svh items-center justify-center p-6">
        {children}
      </main>
    </NeonAuthUIProvider>
  );
}
