"use client";

import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { translate } from "@/i18n/runtime";

// Mirrors src/lib/auth/persistentCookies.ts: this flag cookie is what the
// auth handler reads to extend the session cookies with a 30-day Max-Age.
// Keep the two spellings in sync.
const REMEMBER_ME_COOKIE = "remember_me";
const REMEMBER_ME_MAX_AGE = 2592000; // 30 days, same lifetime the server applies.

function writeRememberFlag(remember: boolean): void {
  document.cookie = remember
    ? `${REMEMBER_ME_COOKIE}=1; path=/; max-age=${REMEMBER_ME_MAX_AGE}; samesite=lax`
    : `${REMEMBER_ME_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

function hasRememberFlag(): boolean {
  return document.cookie.split(";").some((pair) => {
    const eq = pair.indexOf("=");
    return pair.slice(0, eq).trim() === REMEMBER_ME_COOKIE && pair.slice(eq + 1).trim() === "1";
  });
}

/**
 * "Keep me signed in" for the sign-in screen.
 *
 * The form comes from Neon's AuthView and cannot host extra fields, so the
 * checkbox lives just below the card and only writes the flag cookie: the
 * server side of the contract (persistentCookies) turns it into persistent
 * session cookies. Unchecked — or a fresh browser — keeps the cookies
 * session-scoped exactly as they were before the feature existed.
 */
export function RememberMeCheckbox() {
  // The cookie is unreadable during SSR; syncing after mount keeps hydration
  // stable instead of guessing the checked state on the server.
  const [remember, setRemember] = useState(false);
  useEffect(() => setRemember(hasRememberFlag()), []);

  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <Checkbox
        id="remember-me"
        checked={remember}
        onCheckedChange={(checked) => {
          const next = checked === true;
          setRemember(next);
          writeRememberFlag(next);
        }}
      />
      <label htmlFor="remember-me" className="cursor-pointer select-none text-sm text-text-muted">
        {translate("Keep me signed in") || "Keep me signed in"}
      </label>
    </div>
  );
}
