import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const SERVER_ONLY_MODULES = [
  "@/lib/env",
  "@/lib/db",
  "@/lib/db/*",
  "@/lib/repo/*",
  "@/lib/chat/run-turn",
  "@/lib/providers/index",
  "@/lib/providers/anthropic",
  "@/lib/providers/availability",
  "@anthropic-ai/sdk",
  "@anthropic-ai/sdk/*",
  "better-sqlite3",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Vendor SDKs are imported only inside src/lib/providers/.
    files: ["src/**"],
    ignores: ["src/lib/providers/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
              allowTypeImports: true,
              message: "Import vendor SDKs only inside src/lib/providers/.",
            },
          ],
        },
      ],
    },
  },
  {
    // Apply client restrictions last so the broad SDK rule cannot replace them.
    files: ["src/components/**", "src/hooks/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@/lib/providers", allowTypeImports: true, message: "Server-only module; client code must go through an API route." }],
          patterns: [
            {
              group: SERVER_ONLY_MODULES,
              allowTypeImports: true,
              message: "Server-only module; client code must go through an API route.",
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
    "src/lib/db/migrations/**",
  ]),
]);

export default eslintConfig;
