import type { LLMTask } from "@openswe/shared/open-swe/llm-task";
import type { QueryCluster } from "./query-clusters.js";
import type { ModelTier } from "./model-tiers.js";
import { MODEL_TIER_REGISTRY } from "./model-tiers.js";
import { createLogger, LogLevel } from "../../utils/logger.js";

const logger = createLogger(LogLevel.INFO, "routing");

export interface RoutingLogEntry {
  timestamp: number;
  event: "routing" | "cascade_escalation";
  task: LLMTask;
  cluster: QueryCluster;
  tier: ModelTier;
  modelName: string;
  budgetUtilization: number;
  cascadeReason?: string;
}

export interface RoutingSummary {
  callsByTier: Record<string, number>;
  callsByCluster: Record<string, number>;
  cascadeCount: number;
  totalCalls: number;
  cascadeRate: number;
  estimatedCost: number;
  costIfAlwaysPremium: number;
  costSavingsVsAlwaysPremium: number;
}

export class RuntimeLogger {
  private entries: RoutingLogEntry[] = [];

  logRouting(entry: Omit<RoutingLogEntry, "timestamp" | "event">): void {
    const full: RoutingLogEntry = {
      ...entry,
      timestamp: Date.now(),
      event: "routing",
    };
    this.entries.push(full);
    logger.debug("Routed query", {
      task: entry.task,
      cluster: entry.cluster,
      tier: entry.tier,
      model: entry.modelName,
      budgetUtil: `${(entry.budgetUtilization * 100).toFixed(0)}%`,
    });
  }

  logCascadeEscalation(
    entry: Omit<RoutingLogEntry, "timestamp" | "event"> & {
      cascadeReason: string;
    },
  ): void {
    const full: RoutingLogEntry = {
      ...entry,
      timestamp: Date.now(),
      event: "cascade_escalation",
    };
    this.entries.push(full);
    logger.info("Cascade escalation", {
      task: entry.task,
      cluster: entry.cluster,
      tier: entry.tier,
      reason: entry.cascadeReason,
    });
  }

  getEntries(): readonly RoutingLogEntry[] {
    return this.entries;
  }

  getSummary(): RoutingSummary {
    const callsByTier: Record<string, number> = {};
    const callsByCluster: Record<string, number> = {};
    let cascadeCount = 0;
    let estimatedCost = 0;
    let costIfAlwaysPremium = 0;

    // Approximate tokens per call for cost estimation
    const AVG_INPUT_TOKENS = 4000;
    const AVG_OUTPUT_TOKENS = 1000;

    for (const entry of this.entries) {
      callsByTier[entry.tier] = (callsByTier[entry.tier] ?? 0) + 1;
      callsByCluster[entry.cluster] =
        (callsByCluster[entry.cluster] ?? 0) + 1;

      if (entry.event === "cascade_escalation") {
        cascadeCount++;
      }

      const tierConfig = MODEL_TIER_REGISTRY[entry.tier];
      estimatedCost +=
        (AVG_INPUT_TOKENS / 1_000_000) * tierConfig.costPerInputMTok +
        (AVG_OUTPUT_TOKENS / 1_000_000) * tierConfig.costPerOutputMTok;

      const premiumConfig = MODEL_TIER_REGISTRY["PREMIUM" as ModelTier];
      costIfAlwaysPremium +=
        (AVG_INPUT_TOKENS / 1_000_000) * premiumConfig.costPerInputMTok +
        (AVG_OUTPUT_TOKENS / 1_000_000) * premiumConfig.costPerOutputMTok;
    }

    const totalCalls = this.entries.length;
    return {
      callsByTier,
      callsByCluster,
      cascadeCount,
      totalCalls,
      cascadeRate: totalCalls > 0 ? cascadeCount / totalCalls : 0,
      estimatedCost,
      costIfAlwaysPremium,
      costSavingsVsAlwaysPremium:
        costIfAlwaysPremium > 0
          ? 1 - estimatedCost / costIfAlwaysPremium
          : 0,
    };
  }
}
