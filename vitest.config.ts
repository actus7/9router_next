import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["json", "text-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/prisma/**", "migrations/**", "src/components/ui/**", "**/*.d.ts"],
      thresholds: {
        statements: 4.13,
        branches: 2.27,
        functions: 3.47,
        lines: 4.49,
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
