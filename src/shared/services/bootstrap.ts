import { initializeApp } from "./initializeApp";

// Skip during Next.js build/prerender — bootstrap would download cloudflared, init DNS, etc.
const isBuildPhase: boolean =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-export" ||
  process.env.NEXT_PHASE === "phase-static";

declare global {
  // eslint-disable-next-line no-var
  var __appBootstrapped: boolean | undefined;
}

// Server-only singleton: guard via global so HMR / re-imports don't double-init
if (typeof window === "undefined" && !isBuildPhase && !global.__appBootstrapped) {
  global.__appBootstrapped = true;
  initializeApp().catch((e: Error) => console.error("[Bootstrap] init failed:", e.message));
}
