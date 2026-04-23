import { ModelTier, isHigherOrEqualTier } from "./model-tiers.js";

export enum QueryCluster {
  FILE_EXPLORATION = "FILE_EXPLORATION",
  SIMPLE_EDIT = "SIMPLE_EDIT",
  COMMAND_EXECUTION = "COMMAND_EXECUTION",
  CODE_GENERATION = "CODE_GENERATION",
  PLAN_UPDATE = "PLAN_UPDATE",
  ERROR_DIAGNOSIS = "ERROR_DIAGNOSIS",
  COMPLEX_REFACTOR = "COMPLEX_REFACTOR",
  CROSS_FILE_REASONING = "CROSS_FILE_REASONING",
  CODE_REVIEW = "CODE_REVIEW",
  SUMMARIZATION = "SUMMARIZATION",
  ROUTING_CLASSIFICATION = "ROUTING_CLASSIFICATION",
}

export interface ClusterQualityProfile {
  /** The cheapest tier that can still produce acceptable output for this cluster. */
  minViableTier: ModelTier;
  /** The ideal tier when budget is plentiful. */
  preferredTier: ModelTier;
  /**
   * How much quality drops when moving one tier below preferred.
   * 0 = no quality loss (tier doesn't matter), 1 = severe quality loss.
   */
  qualityDropoff: number;
}

/**
 * Per-cluster quality profiles that drive routing decisions.
 * minViableTier <= preferredTier is enforced by tests.
 */
export const CLUSTER_QUALITY_PROFILES: Record<QueryCluster, ClusterQualityProfile> = {
  [QueryCluster.FILE_EXPLORATION]: {
    minViableTier: ModelTier.ECONOMY,
    preferredTier: ModelTier.ECONOMY,
    qualityDropoff: 0.05,
  },
  [QueryCluster.SIMPLE_EDIT]: {
    minViableTier: ModelTier.ECONOMY,
    preferredTier: ModelTier.STANDARD,
    qualityDropoff: 0.15,
  },
  [QueryCluster.COMMAND_EXECUTION]: {
    minViableTier: ModelTier.ECONOMY,
    preferredTier: ModelTier.ECONOMY,
    qualityDropoff: 0.05,
  },
  [QueryCluster.CODE_GENERATION]: {
    minViableTier: ModelTier.STANDARD,
    preferredTier: ModelTier.PREMIUM,
    qualityDropoff: 0.4,
  },
  [QueryCluster.PLAN_UPDATE]: {
    minViableTier: ModelTier.STANDARD,
    preferredTier: ModelTier.STANDARD,
    qualityDropoff: 0.2,
  },
  [QueryCluster.ERROR_DIAGNOSIS]: {
    minViableTier: ModelTier.STANDARD,
    preferredTier: ModelTier.PREMIUM,
    qualityDropoff: 0.35,
  },
  [QueryCluster.COMPLEX_REFACTOR]: {
    minViableTier: ModelTier.PREMIUM,
    preferredTier: ModelTier.PREMIUM,
    qualityDropoff: 0.6,
  },
  [QueryCluster.CROSS_FILE_REASONING]: {
    minViableTier: ModelTier.STANDARD,
    preferredTier: ModelTier.PREMIUM,
    qualityDropoff: 0.5,
  },
  [QueryCluster.CODE_REVIEW]: {
    minViableTier: ModelTier.STANDARD,
    preferredTier: ModelTier.STANDARD,
    qualityDropoff: 0.25,
  },
  [QueryCluster.SUMMARIZATION]: {
    minViableTier: ModelTier.ECONOMY,
    preferredTier: ModelTier.STANDARD,
    qualityDropoff: 0.1,
  },
  [QueryCluster.ROUTING_CLASSIFICATION]: {
    minViableTier: ModelTier.ECONOMY,
    preferredTier: ModelTier.ECONOMY,
    qualityDropoff: 0.0,
  },
};

/**
 * Validate that a profile's minViableTier is at or below its preferredTier.
 */
export function isProfileConsistent(profile: ClusterQualityProfile): boolean {
  return isHigherOrEqualTier(profile.preferredTier, profile.minViableTier);
}
