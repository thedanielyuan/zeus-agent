import { getEnv } from "@/lib/env";
import type { Vendor } from "./types";

/**
 * Whether the server has credentials for a vendor. Server-only (reads env).
 * Kept separate from index.ts so pages can check availability without
 * pulling a vendor SDK into their bundle.
 */
export function isVendorAvailable(vendor: Vendor): boolean {
  const env = getEnv();
  switch (vendor) {
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  }
}

/** Human-readable setup hint shown when a vendor has no credentials. */
export function credentialHint(vendor: Vendor): string {
  switch (vendor) {
    case "anthropic":
      return "Set ANTHROPIC_API_KEY in .env.local and restart the server.";
  }
}
