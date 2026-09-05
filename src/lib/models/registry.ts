import type { ModelSpec, Vendor } from "@/lib/providers/types";

/**
 * Single source of truth for model IDs, prices, limits, and capabilities.
 * Never hard-code a model string anywhere else.
 */
export const MODELS: readonly ModelSpec[] = [
  {
    id: "claude-sonnet-5",
    vendor: "anthropic",
    displayName: "Claude Sonnet 5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricePerMTok: { input: 2.0, output: 10.0 },
    capabilities: {
      thinking: true,
      effort: true,
      vision: true,
      tools: true,
      caching: true,
      sampling: false,
    },
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-5";

export function getModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}

/** What the browser is allowed to know about a model. No prices, no keys. */
export interface PublicModel {
  id: string;
  vendor: Vendor;
  displayName: string;
  maxOutputTokens: number;
  capabilities: ModelSpec["capabilities"];
  available: boolean;
}

export function toPublicModel(m: ModelSpec, available: boolean): PublicModel {
  return {
    id: m.id,
    vendor: m.vendor,
    displayName: m.displayName,
    maxOutputTokens: m.maxOutputTokens,
    capabilities: m.capabilities,
    available,
  };
}
