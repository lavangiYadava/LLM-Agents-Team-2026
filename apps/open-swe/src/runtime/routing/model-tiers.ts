import type { Provider } from "../../utils/llms/model-manager.js";

export enum ModelTier {
  PREMIUM = "PREMIUM",
  STANDARD = "STANDARD",
  ECONOMY = "ECONOMY",
}

export interface ModelTierConfig {
  tier: ModelTier;
  models: Record<Provider, string>;
  costPerInputMTok: number;
  costPerOutputMTok: number;
}

/**
 * Registry mapping each tier to concrete model names per provider and cost data.
 * Model names align with defaults in model-manager.ts:380-409.
 */
export const MODEL_TIER_REGISTRY: Record<ModelTier, ModelTierConfig> = {
  [ModelTier.PREMIUM]: {
    tier: ModelTier.PREMIUM,
    models: {
      anthropic: "claude-opus-4-5",
      openai: "gpt-5-codex",
      "google-genai": "gemini-3-pro-preview",
    },
    costPerInputMTok: 15.0,
    costPerOutputMTok: 75.0,
  },
  [ModelTier.STANDARD]: {
    tier: ModelTier.STANDARD,
    models: {
      anthropic: "claude-sonnet-4-5",
      openai: "gpt-5-mini",
      "google-genai": "gemini-2.5-pro",
    },
    costPerInputMTok: 3.0,
    costPerOutputMTok: 15.0,
  },
  [ModelTier.ECONOMY]: {
    tier: ModelTier.ECONOMY,
    models: {
      anthropic: "claude-haiku-4-5",
      openai: "gpt-5-nano",
      "google-genai": "gemini-2.5-flash",
    },
    costPerInputMTok: 0.8,
    costPerOutputMTok: 4.0,
  },
};

/** Ordered tiers from highest to lowest capability. */
export const TIER_ORDER: ModelTier[] = [
  ModelTier.PREMIUM,
  ModelTier.STANDARD,
  ModelTier.ECONOMY,
];

/** Numeric index for tier comparison (lower = more capable). */
export function tierIndex(tier: ModelTier): number {
  return TIER_ORDER.indexOf(tier);
}

/** Returns true if `a` is a higher (or equal) tier than `b`. */
export function isHigherOrEqualTier(a: ModelTier, b: ModelTier): boolean {
  return tierIndex(a) <= tierIndex(b);
}

/** Degrade tier by `steps` levels, clamped to the bottom of TIER_ORDER. */
export function degradeTier(tier: ModelTier, steps: number): ModelTier {
  const idx = tierIndex(tier);
  const degradedIdx = Math.min(idx + steps, TIER_ORDER.length - 1);
  return TIER_ORDER[degradedIdx];
}

/** Escalate tier by one level (ECONOMY→STANDARD, STANDARD→PREMIUM). Returns null if already PREMIUM. */
export function escalateTier(tier: ModelTier): ModelTier | null {
  const idx = tierIndex(tier);
  if (idx <= 0) return null;
  return TIER_ORDER[idx - 1];
}

/**
 * Reverse lookup: given a model name string, find which tier it belongs to.
 * Returns undefined if not found in any tier.
 */
export function getTierForModel(modelName: string): ModelTier | undefined {
  for (const tier of TIER_ORDER) {
    const config = MODEL_TIER_REGISTRY[tier];
    for (const provider of Object.keys(config.models) as Provider[]) {
      if (config.models[provider] === modelName) {
        return tier;
      }
    }
  }
  return undefined;
}

/**
 * Estimate cost of a single LLM call at a given tier.
 * Returns cost in dollars.
 */
export function estimateCallCost(
  tier: ModelTier,
  inputTokens: number,
  outputTokens: number,
): number {
  const config = MODEL_TIER_REGISTRY[tier];
  const inputCost = (inputTokens / 1_000_000) * config.costPerInputMTok;
  const outputCost = (outputTokens / 1_000_000) * config.costPerOutputMTok;
  return inputCost + outputCost;
}

/**
 * Map our ModelTier to the existing telemetry NodeRecord.modelTier values.
 */
export function tierToTelemetryTier(
  tier: ModelTier,
): "LOW" | "MID" | "HIGH" {
  switch (tier) {
    case ModelTier.PREMIUM:
      return "HIGH";
    case ModelTier.STANDARD:
      return "MID";
    case ModelTier.ECONOMY:
      return "LOW";
  }
}
