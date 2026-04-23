import { GraphConfig } from "@openswe/shared/open-swe/types";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import {
  checkBudget,
} from "@openswe/shared/open-swe/budget-enforcement";
import type {
  BudgetState,
} from "@openswe/shared/open-swe/budget-types";
import {
  ModelManager,
  type ModelManagerConfig,
  type Provider,
} from "../../utils/llms/model-manager.js";
import {
  ModelTier,
  MODEL_TIER_REGISTRY,
  degradeTier,
} from "./model-tiers.js";
import {
  QueryCluster,
  CLUSTER_QUALITY_PROFILES,
  type ClusterQualityProfile,
} from "./query-clusters.js";
import { classifyQuery, type ToolCallHint } from "./query-classifier.js";
import { RuntimeLogger } from "./runtime-logger.js";
import { createLogger, LogLevel } from "../../utils/logger.js";

const logger = createLogger(LogLevel.INFO, "ClusterAwareModelManager");

export type RoutingStrategy =
  | "cluster-adaptive"
  | "fixed-tier"
  | "task-priority";

const DEFAULT_DEGRADATION_THRESHOLDS = [0.6, 0.85] as const;

export interface RoutingDecision {
  cluster: QueryCluster;
  tier: ModelTier;
  modelName: string;
  provider: Provider;
  degradationLevel: number;
}

/**
 * Extends ModelManager with cluster-aware model routing.
 *
 * On each `loadModel()` call:
 * 1. Checks budget exhaustion
 * 2. Classifies the query into a cluster
 * 3. Resolves the target tier based on cluster + budget + strategy
 * 4. Overrides the model name in graphConfig
 * 5. Logs the routing decision
 * 6. Delegates to super.loadModel()
 */
export class ClusterAwareModelManager extends ModelManager {
  private routingLogger: RuntimeLogger;
  private lastDecision: RoutingDecision | null = null;

  constructor(config: Partial<ModelManagerConfig> = {}) {
    super(config);
    this.routingLogger = new RuntimeLogger();
    logger.info("ClusterAwareModelManager initialized");
  }

  /**
   * Override loadModel to inject cluster-aware routing.
   */
  async loadModel(graphConfig: GraphConfig, task: LLMTask) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configurable = (graphConfig.configurable ?? {}) as any;

    // 1. Check budget
    const budgetState = configurable.budgetState as BudgetState | undefined;
    if (budgetState) {
      const budgetCheck = checkBudget(budgetState);
      if (!budgetCheck.canContinue) {
        throw new Error(
          `Budget exhausted — cannot route model for task ${task}`,
        );
      }
    }

    // 2. Extract routing context
    const strategy = this.getRoutingStrategy(configurable);
    const prompt = this.extractPromptContext(configurable);
    const toolCalls = this.extractToolCallHints(configurable);

    // 3. Classify query
    const cluster = classifyQuery(prompt, task, toolCalls);

    // 4. Resolve target tier
    const tier = this.resolveClusterTier(
      cluster,
      task,
      strategy,
      configurable,
      budgetState,
    );

    // 5. Determine the concrete provider from the current config
    const provider = this.resolveProvider(configurable, task);
    const modelName = MODEL_TIER_REGISTRY[tier].models[provider];

    // 6. Override model in config
    const modelKey = `${task}ModelName`;
    const fullModelName = `${provider}:${modelName}`;

    if (graphConfig.configurable) {
      (graphConfig.configurable as Record<string, unknown>)[modelKey] = fullModelName;
    }

    // 7. Record decision
    const budgetUtil = budgetState
      ? checkBudget(budgetState).tokenUtilization
      : 0;

    this.lastDecision = {
      cluster,
      tier,
      modelName: fullModelName,
      provider,
      degradationLevel: this.computeDegradationLevel(configurable, budgetState),
    };

    this.routingLogger.logRouting({
      task,
      cluster,
      tier,
      modelName: fullModelName,
      budgetUtilization: budgetUtil,
    });

    // 8. Delegate to parent
    return super.loadModel(graphConfig, task);
  }

  /**
   * Core routing logic: determine the target tier for a cluster.
   */
  private resolveClusterTier(
    cluster: QueryCluster,
    task: LLMTask,
    strategy: RoutingStrategy,
    configurable: Record<string, unknown>,
    budgetState?: BudgetState,
  ): ModelTier {
    const profile = CLUSTER_QUALITY_PROFILES[cluster];

    switch (strategy) {
      case "fixed-tier":
        return this.resolveFixedTier(configurable, profile);

      case "task-priority":
        if (task === LLMTask.PROGRAMMER) {
          return ModelTier.PREMIUM;
        }
        return this.resolveAdaptiveTier(profile, configurable, budgetState);

      case "cluster-adaptive":
      default:
        return this.resolveAdaptiveTier(profile, configurable, budgetState);
    }
  }

  /**
   * Fixed-tier strategy: use the configured tier, clamped to minViableTier.
   */
  private resolveFixedTier(
    configurable: Record<string, unknown>,
    profile: ClusterQualityProfile,
  ): ModelTier {
    const tierStr = (configurable.fixedTier as string) ?? "premium";
    const tierMap: Record<string, ModelTier> = {
      premium: ModelTier.PREMIUM,
      standard: ModelTier.STANDARD,
      economy: ModelTier.ECONOMY,
    };
    const requested = tierMap[tierStr] ?? ModelTier.PREMIUM;

    // Never go below minViableTier
    const minIdx = tierIndex(profile.minViableTier);
    const reqIdx = tierIndex(requested);
    return reqIdx > minIdx ? profile.minViableTier : requested;
  }

  /**
   * Cluster-adaptive strategy: start from preferred tier, degrade based on budget.
   */
  private resolveAdaptiveTier(
    profile: ClusterQualityProfile,
    configurable: Record<string, unknown>,
    budgetState?: BudgetState,
  ): ModelTier {
    const degradationLevel = this.computeDegradationLevel(
      configurable,
      budgetState,
    );
    const degraded = degradeTier(profile.preferredTier, degradationLevel);

    // Clamp to minViableTier
    const minIdx = tierIndex(profile.minViableTier);
    const degradedIdx = tierIndex(degraded);
    return degradedIdx > minIdx ? profile.minViableTier : degraded;
  }

  /**
   * Compute how many tier steps to degrade based on budget utilization.
   * Returns 0, 1, or 2.
   */
  private computeDegradationLevel(
    configurable: Record<string, unknown>,
    budgetState?: BudgetState,
  ): number {
    if (!budgetState) return 0;

    const budgetCheck = checkBudget(budgetState);
    const utilization = Math.max(
      budgetCheck.tokenUtilization,
      budgetCheck.toolCallUtilization,
      budgetCheck.actionUtilization,
    );

    const thresholds = (configurable.degradationThresholds as number[]) ??
      DEFAULT_DEGRADATION_THRESHOLDS;

    const [warning, critical] = thresholds;

    if (utilization >= critical) return 2;
    if (utilization >= warning) return 1;
    return 0;
  }

  /**
   * Extract the provider from the current model config.
   */
  private resolveProvider(
    configurable: Record<string, unknown>,
    task: LLMTask,
  ): Provider {
    const modelKey = `${task}ModelName`;
    const modelStr = configurable[modelKey] as string | undefined;
    if (modelStr && modelStr.includes(":")) {
      return modelStr.split(":")[0] as Provider;
    }
    return "anthropic";
  }

  private getRoutingStrategy(
    configurable: Record<string, unknown>,
  ): RoutingStrategy {
    const strategy = configurable.routingStrategy as string | undefined;
    if (
      strategy === "cluster-adaptive" ||
      strategy === "fixed-tier" ||
      strategy === "task-priority"
    ) {
      return strategy;
    }
    return "cluster-adaptive";
  }

  private extractPromptContext(
    configurable: Record<string, unknown>,
  ): string {
    // Try to extract from last message or prompt field
    const lastPrompt = configurable.lastPrompt as string | undefined;
    return lastPrompt ?? "";
  }

  private extractToolCallHints(
    configurable: Record<string, unknown>,
  ): ToolCallHint[] | undefined {
    const hints = configurable.lastToolCalls as ToolCallHint[] | undefined;
    return hints;
  }

  /** Get the last routing decision (useful for cascade logic). */
  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  /** Get the routing logger for summary/telemetry. */
  getRoutingLogger(): RuntimeLogger {
    return this.routingLogger;
  }
}

// Helper imported from model-tiers but needed locally for clamping
function tierIndex(tier: ModelTier): number {
  const order = [ModelTier.PREMIUM, ModelTier.STANDARD, ModelTier.ECONOMY];
  return order.indexOf(tier);
}
