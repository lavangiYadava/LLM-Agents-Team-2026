import { describe, expect, it } from "@jest/globals";
import {
  ModelTier,
  MODEL_TIER_REGISTRY,
  TIER_ORDER,
  getTierForModel,
  estimateCallCost,
  degradeTier,
  escalateTier,
  tierIndex,
  isHigherOrEqualTier,
  tierToTelemetryTier,
} from "../../runtime/routing/model-tiers.js";
import type { Provider } from "../../utils/llms/model-manager.js";

const ALL_PROVIDERS: Provider[] = ["anthropic", "openai", "google-genai"];

describe("MODEL_TIER_REGISTRY", () => {
  it("has entries for all three tiers", () => {
    expect(MODEL_TIER_REGISTRY[ModelTier.PREMIUM]).toBeDefined();
    expect(MODEL_TIER_REGISTRY[ModelTier.STANDARD]).toBeDefined();
    expect(MODEL_TIER_REGISTRY[ModelTier.ECONOMY]).toBeDefined();
  });

  it("has valid model names for all providers in each tier", () => {
    for (const tier of TIER_ORDER) {
      const config = MODEL_TIER_REGISTRY[tier];
      for (const provider of ALL_PROVIDERS) {
        expect(config.models[provider]).toBeDefined();
        expect(typeof config.models[provider]).toBe("string");
        expect(config.models[provider].length).toBeGreaterThan(0);
      }
    }
  });

  it("has cost ordering PREMIUM > STANDARD > ECONOMY", () => {
    const premium = MODEL_TIER_REGISTRY[ModelTier.PREMIUM];
    const standard = MODEL_TIER_REGISTRY[ModelTier.STANDARD];
    const economy = MODEL_TIER_REGISTRY[ModelTier.ECONOMY];

    expect(premium.costPerInputMTok).toBeGreaterThan(
      standard.costPerInputMTok,
    );
    expect(standard.costPerInputMTok).toBeGreaterThan(
      economy.costPerInputMTok,
    );
    expect(premium.costPerOutputMTok).toBeGreaterThan(
      standard.costPerOutputMTok,
    );
    expect(standard.costPerOutputMTok).toBeGreaterThan(
      economy.costPerOutputMTok,
    );
  });
});

describe("getTierForModel", () => {
  it("reverse lookup works for all models in registry", () => {
    for (const tier of TIER_ORDER) {
      const config = MODEL_TIER_REGISTRY[tier];
      for (const provider of ALL_PROVIDERS) {
        const modelName = config.models[provider];
        expect(getTierForModel(modelName)).toBe(tier);
      }
    }
  });

  it("returns undefined for unknown model", () => {
    expect(getTierForModel("nonexistent-model")).toBeUndefined();
  });
});

describe("estimateCallCost", () => {
  it("calculates correct cost", () => {
    const cost = estimateCallCost(ModelTier.PREMIUM, 1_000_000, 1_000_000);
    const expected =
      MODEL_TIER_REGISTRY[ModelTier.PREMIUM].costPerInputMTok +
      MODEL_TIER_REGISTRY[ModelTier.PREMIUM].costPerOutputMTok;
    expect(cost).toBeCloseTo(expected);
  });

  it("returns 0 for 0 tokens", () => {
    expect(estimateCallCost(ModelTier.ECONOMY, 0, 0)).toBe(0);
  });

  it("PREMIUM costs more than ECONOMY for same tokens", () => {
    const premiumCost = estimateCallCost(ModelTier.PREMIUM, 4000, 1000);
    const economyCost = estimateCallCost(ModelTier.ECONOMY, 4000, 1000);
    expect(premiumCost).toBeGreaterThan(economyCost);
  });
});

describe("degradeTier", () => {
  it("degrades PREMIUM by 1 step to STANDARD", () => {
    expect(degradeTier(ModelTier.PREMIUM, 1)).toBe(ModelTier.STANDARD);
  });

  it("degrades PREMIUM by 2 steps to ECONOMY", () => {
    expect(degradeTier(ModelTier.PREMIUM, 2)).toBe(ModelTier.ECONOMY);
  });

  it("clamps at ECONOMY for excessive degradation", () => {
    expect(degradeTier(ModelTier.PREMIUM, 10)).toBe(ModelTier.ECONOMY);
  });

  it("degrades ECONOMY by 0 stays at ECONOMY", () => {
    expect(degradeTier(ModelTier.ECONOMY, 0)).toBe(ModelTier.ECONOMY);
  });
});

describe("escalateTier", () => {
  it("escalates ECONOMY to STANDARD", () => {
    expect(escalateTier(ModelTier.ECONOMY)).toBe(ModelTier.STANDARD);
  });

  it("escalates STANDARD to PREMIUM", () => {
    expect(escalateTier(ModelTier.STANDARD)).toBe(ModelTier.PREMIUM);
  });

  it("returns null when already PREMIUM", () => {
    expect(escalateTier(ModelTier.PREMIUM)).toBeNull();
  });
});

describe("tierIndex", () => {
  it("PREMIUM < STANDARD < ECONOMY", () => {
    expect(tierIndex(ModelTier.PREMIUM)).toBeLessThan(
      tierIndex(ModelTier.STANDARD),
    );
    expect(tierIndex(ModelTier.STANDARD)).toBeLessThan(
      tierIndex(ModelTier.ECONOMY),
    );
  });
});

describe("isHigherOrEqualTier", () => {
  it("PREMIUM >= ECONOMY", () => {
    expect(isHigherOrEqualTier(ModelTier.PREMIUM, ModelTier.ECONOMY)).toBe(
      true,
    );
  });

  it("ECONOMY < PREMIUM", () => {
    expect(isHigherOrEqualTier(ModelTier.ECONOMY, ModelTier.PREMIUM)).toBe(
      false,
    );
  });

  it("same tier is equal", () => {
    expect(
      isHigherOrEqualTier(ModelTier.STANDARD, ModelTier.STANDARD),
    ).toBe(true);
  });
});

describe("tierToTelemetryTier", () => {
  it("maps to existing NodeRecord modelTier values", () => {
    expect(tierToTelemetryTier(ModelTier.PREMIUM)).toBe("HIGH");
    expect(tierToTelemetryTier(ModelTier.STANDARD)).toBe("MID");
    expect(tierToTelemetryTier(ModelTier.ECONOMY)).toBe("LOW");
  });
});
