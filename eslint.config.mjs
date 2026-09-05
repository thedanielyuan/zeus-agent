import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const SERVER_ONLY_MODULES = [
  "@/lib/env",
  "@/lib/db",
  "@/lib/db/*",
  "@/lib/providers",
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
    // Client code never touches env, the DB, or a vendor SDK (ARCHITECTURE.md §9, §10).
    files: ["src/components/**", "src/hooks/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
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
  {
    // Vendor SDKs are imported only inside src/lib/providers/ (ARCHITECTURE.md §1).
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
