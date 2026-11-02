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
      // Locked to the real measured coverage (2026-11-02, integration candidate:
      // 31.62 statements, 25.83 branches, 32.15 functions, 32.98 lines) minus 0.5
      // against run-to-run noise — not an aspirational target. Raise these as
      // coverage genuinely grows; do not lower them to make a build pass.
      // Per-file floors are measured minus 2, capped at 80.
      thresholds: {
        statements: 31.1,
        branches: 25.3,
        functions: 31.6,
        lines: 32.4,
        "src/server/llm-gateway/application/accessScope.ts": { statements: 80, branches: 80, functions: 80, lines: 80 },
        "src/server/application/http/usageLimits.ts": { statements: 80, branches: 78, functions: 80, lines: 80 },
        "src/server/llm-gateway/engine/services/smart-routing/router.ts": { statements: 80, branches: 77.4, functions: 80, lines: 80 },
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
