"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/**
 * Browser-side auth. Talks to `/api/auth/*` on this origin, which the route
 * handler proxies to Neon Auth — so the session cookie stays first-party and
 * the auth host is never called from the browser directly.
 */
export const authClient = createAuthClient();
