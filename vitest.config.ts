import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15000,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["json", "text-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/prisma/**", "migrations/**", "src/components/ui/**", "**/*.d.ts"],
      // Locked to the real measured coverage (2026-09-03: 10.15 statements,
      // 6.69 branches, 9.92 functions, 10.82 lines) with a small buffer against
      // run-to-run noise — not an aspirational target. Raise these as coverage
      // genuinely grows; do not lower them to make a build pass.
      thresholds: {
        statements: 9.9,
        branches: 6.4,
        functions: 9.6,
        lines: 10.5,
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
