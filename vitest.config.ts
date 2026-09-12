import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/tenant.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15000,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["json", "text-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/prisma/**", "migrations/**", "src/components/ui/**", "**/*.d.ts"],
      // Locked to the real measured coverage (2026-09-11: 15.12 statements,
      // 10.23 branches, 14.88 functions, 16.08 lines) with a small buffer against
      // run-to-run noise — not an aspirational target. Raise these as coverage
      // genuinely grows; do not lower them to make a build pass.
      //
      // Left at the 2026-09-03 numbers, the ratchet had stopped ratcheting: it
      // would have taken a third of the suite disappearing to trip.
      thresholds: {
        statements: 14.7,
        branches: 9.9,
        functions: 14.5,
        lines: 15.6,
        "src/shared/components/SafeMarkdown.tsx": { statements: 80, branches: 80, functions: 80, lines: 80 },
        "src/shared/utils/ssrfGuard.ts": { statements: 80, branches: 80, functions: 80, lines: 80 },
        "src/server/security/safeFetch.ts": { statements: 80, branches: 80, functions: 80, lines: 80 },
        "src/lib/db/errors.ts": { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/setup/server-only.ts", import.meta.url)),
    },
  },
});
