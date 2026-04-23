import { describe, expect, it } from "@jest/globals";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { RuntimeLogger } from "../../runtime/routing/runtime-logger.js";
import { ModelTier } from "../../runtime/routing/model-tiers.js";
import { QueryCluster } from "../../runtime/routing/query-clusters.js";

function makeLogger(): RuntimeLogger {
  return new RuntimeLogger();
}

describe("RuntimeLogger", () => {
  it("logs routing entries", () => {
    const rl = makeLogger();
    rl.logRouting({
      task: LLMTask.PROGRAMMER,
      cluster: QueryCluster.CODE_GENERATION,
      tier: ModelTier.PREMIUM,
      modelName: "anthropic:claude-opus-4-5",
      budgetUtilization: 0.3,
    });

    const entries = rl.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("routing");
    expect(entries[0].cluster).toBe(QueryCluster.CODE_GENERATION);
    expect(entries[0].tier).toBe(ModelTier.PREMIUM);
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it("logs cascade escalation entries", () => {
    const rl = makeLogger();
    rl.logCascadeEscalation({
      task: LLMTask.PROGRAMMER,
      cluster: QueryCluster.CODE_GENERATION,
      tier: ModelTier.STANDARD,
      modelName: "anthropic:claude-sonnet-4-5",
      budgetUtilization: 0.5,
      cascadeReason: "empty_response",
    });

    const entries = rl.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("cascade_escalation");
    expect(entries[0].cascadeReason).toBe("empty_response");
  });

  describe("getSummary", () => {
    it("returns correct counts by tier", () => {
      const rl = makeLogger();

      // Log several routing calls at different tiers
      rl.logRouting({
        task: LLMTask.PROGRAMMER,
        cluster: QueryCluster.CODE_GENERATION,
        tier: ModelTier.PREMIUM,
        modelName: "anthropic:claude-opus-4-5",
        budgetUtilization: 0.1,
      });
      rl.logRouting({
        task: LLMTask.PROGRAMMER,
        cluster: QueryCluster.FILE_EXPLORATION,
        tier: ModelTier.ECONOMY,
        modelName: "anthropic:claude-haiku-4-5",
        budgetUtilization: 0.2,
      });
      rl.logRouting({
        task: LLMTask.PROGRAMMER,
        cluster: QueryCluster.COMMAND_EXECUTION,
        tier: ModelTier.ECONOMY,
        modelName: "anthropic:claude-haiku-4-5",
        budgetUtilization: 0.3,
      });

      const summary = rl.getSummary();
      expect(summary.totalCalls).toBe(3);
      expect(summary.callsByTier[ModelTier.PREMIUM]).toBe(1);
      expect(summary.callsByTier[ModelTier.ECONOMY]).toBe(2);
      expect(summary.callsByCluster[QueryCluster.CODE_GENERATION]).toBe(1);
      expect(summary.callsByCluster[QueryCluster.FILE_EXPLORATION]).toBe(1);
      expect(summary.callsByCluster[QueryCluster.COMMAND_EXECUTION]).toBe(1);
    });

    it("calculates cascade rate", () => {
      const rl = makeLogger();

      rl.logRouting({
        task: LLMTask.PROGRAMMER,
        cluster: QueryCluster.CODE_GENERATION,
        tier: ModelTier.ECONOMY,
        modelName: "anthropic:claude-haiku-4-5",
        budgetUtilization: 0.5,
      });
      rl.logCascadeEscalation({
        task: LLMTask.PROGRAMMER,
        cluster: QueryCluster.CODE_GENERATION,
        tier: ModelTier.STANDARD,
        modelName: "anthropic:claude-sonnet-4-5",
        budgetUtilization: 0.5,
        cascadeReason: "empty_response",
      });

      const summary = rl.getSummary();
      expect(summary.totalCalls).toBe(2);
      expect(summary.cascadeCount).toBe(1);
      expect(summary.cascadeRate).toBeCloseTo(0.5);
    });

    it("shows cost savings when using mixed tiers vs always premium", () => {
      const rl = makeLogger();

      // 5 economy calls, 1 premium call
      for (let i = 0; i < 5; i++) {
        rl.logRouting({
          task: LLMTask.PROGRAMMER,
          cluster: QueryCluster.FILE_EXPLORATION,
          tier: ModelTier.ECONOMY,
          modelName: "anthropic:claude-haiku-4-5",
          budgetUtilization: 0.1,
        });
      }
      rl.logRouting({
        task: LLMTask.PROGRAMMER,
        cluster: QueryCluster.CODE_GENERATION,
        tier: ModelTier.PREMIUM,
        modelName: "anthropic:claude-opus-4-5",
        budgetUtilization: 0.1,
      });

      const summary = rl.getSummary();
      expect(summary.costSavingsVsAlwaysPremium).toBeGreaterThan(0);
      expect(summary.estimatedCost).toBeLessThan(summary.costIfAlwaysPremium);
    });

    it("returns zero savings for empty logger", () => {
      const rl = makeLogger();
      const summary = rl.getSummary();
      expect(summary.totalCalls).toBe(0);
      expect(summary.cascadeRate).toBe(0);
      expect(summary.costSavingsVsAlwaysPremium).toBe(0);
    });
  });
});
