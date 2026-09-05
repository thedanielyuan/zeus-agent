import { z } from "zod";

/**
 * Server-only environment access. The only module that reads process.env.
 * Client code must never import this (enforced by ESLint and the window guard).
 */
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().min(1).optional(),
  ZEUS_DB_PATH: z.string().min(1).default("./data/zeus.db"),
  ZEUS_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (typeof window !== "undefined") {
    throw new Error("env.ts is server-only and was imported from browser code");
  }
  if (!cached) {
    cached = EnvSchema.parse({
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || undefined,
      ZEUS_DB_PATH: process.env.ZEUS_DB_PATH || undefined,
      ZEUS_LOG_LEVEL: process.env.ZEUS_LOG_LEVEL || undefined,
    });
  }
  return cached;
}

/** Test helper: force the next getEnv() to re-read process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
