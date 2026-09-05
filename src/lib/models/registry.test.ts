import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, MODELS, getModel, toPublicModel } from "./registry";

describe("model registry", () => {
  it("has unique IDs and a valid default", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getModel(DEFAULT_MODEL_ID)).toBeDefined();
  });

  it("pins Claude Sonnet 5 to the documented spec (PRD FR-M2)", () => {
    const m = getModel("claude-sonnet-5");
    expect(m).toMatchObject({
      vendor: "anthropic",
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      pricePerMTok: { input: 2.0, output: 10.0 },
      capabilities: { thinking: true, effort: true, caching: true, sampling: false },
    });
  });

  it("never exposes prices to the browser", () => {
    const pub = toPublicModel(MODELS[0], true);
    expect(pub).not.toHaveProperty("pricePerMTok");
    expect(pub.available).toBe(true);
  });
});
