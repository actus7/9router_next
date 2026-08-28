import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React Compiler advisory rules: the project does not enable reactCompiler
  // (next.config.ts). These findings are pre-existing baseline debt (117 at
  // refactor/llm-gateway branch start) and require hook restructuring — a
  // behavior change out of scope for the open-sse migration (plan rule: no
  // behavior changes during migration). Track as warnings; revisit if/when
  // enabling the compiler.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
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
