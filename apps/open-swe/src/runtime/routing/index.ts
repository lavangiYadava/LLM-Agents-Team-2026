export {
  ModelTier,
  MODEL_TIER_REGISTRY,
  TIER_ORDER,
  getTierForModel,
  estimateCallCost,
  degradeTier,
  escalateTier,
  tierToTelemetryTier,
  isHigherOrEqualTier,
  tierIndex,
} from "./model-tiers.js";
export type { ModelTierConfig } from "./model-tiers.js";

export {
  QueryCluster,
  CLUSTER_QUALITY_PROFILES,
  isProfileConsistent,
} from "./query-clusters.js";
export type { ClusterQualityProfile } from "./query-clusters.js";

export { classifyQuery } from "./query-classifier.js";
export type { ToolCallHint } from "./query-classifier.js";

export {
  ClusterAwareModelManager,
} from "./cluster-model-manager.js";
export type {
  RoutingStrategy,
  RoutingDecision,
} from "./cluster-model-manager.js";

export { checkOutputQuality, decideCascade } from "./cascade.js";
export type { QualityCheckResult, CascadeDecision } from "./cascade.js";

export { RuntimeLogger } from "./runtime-logger.js";
export type { RoutingLogEntry, RoutingSummary } from "./runtime-logger.js";
