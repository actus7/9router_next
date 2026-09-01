import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The project does not enable the React Compiler (next.config.ts), so its
  // compiler-only static analyses cannot be enforced yet. Re-enable them when
  // the compiler becomes part of the production build.
  {
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "error",
      // These legacy style rules have no runtime effect and would require a
      // repository-wide mechanical rewrite. TypeScript remains the source of
      // truth for type safety while the gateway migration is in progress.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/no-unused-expressions": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
  // Gateway boundary: app/shared code must consume the LLM
  // engine only through the public barrels — @/server/llm-gateway/* (server)
  // and @/shared/llm-catalog (client-safe). Direct deep imports of the legacy
  // @/lib/open-sse and @/sse namespaces are forbidden here. The llm-catalog
  // barrel itself is exempt until the Phase 3 engine rename; src/lib host
  // internals (db/oauth/qoder) are Phase 4 scope and exempt for now.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    ignores: ["src/shared/llm-catalog/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/open-sse", "@/lib/open-sse/*", "@/sse", "@/sse/*"],
              message: "Import from @/server/llm-gateway/* (server) or @/shared/llm-catalog (client) instead.",
            },
          ],
        },
      ],
    },
  },
  // Next route files are transport adapters only. Persistence belongs behind
  // application use cases so HTTP concerns cannot bypass domain boundaries.
  {
    files: ["src/app/api/**/route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db/repos", "@/lib/db/repos/*", "@/lib/db/driver", "@/lib/db/driver/*"],
              message: "Route Handlers must delegate persistence to a server/application use case.",
            },
          ],
        },
      ],
    },
  },
  // Gateway boundary: the engine (server/llm-gateway/engine)
  // must not import host modules directly — host integration goes through
  // the documented adapters in engine/host/. Enforced both here and by
  // tests/unit/hostSeam.test.ts.
  {
    files: ["src/server/llm-gateway/engine/**/*.ts"],
    ignores: ["src/server/llm-gateway/engine/host/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib", "@/lib/*", "@/shared", "@/shared/*", "@/app", "@/app/*", "@/server/llm-gateway", "@/server/llm-gateway/*"],
              message: "Engine must consume host capabilities via engine/host/* adapters (usage, store, catalog, oauth, ssrf).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated artifacts (prisma contract emit / migration snapshots):
    "src/prisma/contract.d.ts",
    "migrations/**",
    // Local agent skills and transient agent state are not application source.
    ".agents/**",
    ".claude/**",
    ".cursor/**",
    ".devin/**",
    ".remember/**",
  ]),
]);

export default eslintConfig;
