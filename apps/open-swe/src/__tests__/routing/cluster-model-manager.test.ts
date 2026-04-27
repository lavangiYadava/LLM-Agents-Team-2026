import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import {
  BudgetStatus,
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_BUDGET_USAGE,
} from "@openswe/shared/open-swe/budget-types";
import type { BudgetState } from "@openswe/shared/open-swe/budget-types";
import type { GraphConfig } from "@openswe/shared/open-swe/types";
import { ModelTier, MODEL_TIER_REGISTRY } from "../../runtime/routing/model-tiers.js";
import { QueryCluster } from "../../runtime/routing/query-clusters.js";

// Mock the parent class's loadModel to avoid actual LLM initialization
const loadModelMock = jest.fn(async () => ({} as any));

jest.unstable_mockModule("../../utils/llms/model-manager.js", () => ({
  ModelManager: class MockModelManager {
    constructor() {}
    async loadModel(...args: any[]) {
      return loadModelMock(...args);
    }
  },
  DEFAULT_MODEL_MANAGER_CONFIG: {
    circuitBreakerFailureThreshold: 2,
    circuitBreakerTimeoutMs: 180000,
    fallbackOrder: ["openai", "anthropic", "google-genai"],
  },
}));

const { ClusterAwareModelManager } = await import(
  "../../runtime/routing/cluster-model-manager.js"
);

function makeConfig(overrides?: Record<string, unknown>): GraphConfig {
  return {
    configurable: {
      programmerModelName: "anthropic:claude-opus-4-5",
      plannerModelName: "anthropic:claude-opus-4-5",
      routerModelName: "anthropic:claude-haiku-4-5",
      summarizerModelName: "anthropic:claude-haiku-4-5",
      reviewerModelName: "anthropic:claude-opus-4-5",
      ...overrides,
    },
  } as GraphConfig;
}

function makeBudgetState(
  tokenUtilization: number,
): BudgetState {
  const tokensUsed = Math.floor(
    DEFAULT_BUDGET_CONFIG.maxBudgetTokens * tokenUtilization,
  );
  return {
    config: { ...DEFAULT_BUDGET_CONFIG },
    usage: {
      ...DEFAULT_BUDGET_USAGE,
      totalTokensUsed: tokensUsed,
    },
    status:
      tokenUtilization >= 1.0
        ? BudgetStatus.EXHAUSTED
        : tokenUtilization >= 0.9
          ? BudgetStatus.DEGRADED
          : tokenUtilization >= 0.8
            ? BudgetStatus.WARNING
            : BudgetStatus.NORMAL,
    lastUpdatedNode: "test",
  };
}

describe("ClusterAwareModelManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("cluster-adaptive strategy", () => {
    it("routes ROUTER task to ECONOMY tier", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "cluster-adaptive",
        budgetState: makeBudgetState(0.1),
      });

      await manager.loadModel(config, LLMTask.ROUTER);

      // ROUTER → ROUTING_CLASSIFICATION cluster → ECONOMY preferred
      expect(loadModelMock).toHaveBeenCalledTimes(1);
      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName = passedConfig.configurable?.routerModelName as string;
      expect(modelName).toContain("haiku");
    });

    it("routes PROGRAMMER task to PREMIUM when budget is low", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "cluster-adaptive",
        budgetState: makeBudgetState(0.1),
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName =
        passedConfig.configurable?.programmerModelName as string;
      // CODE_GENERATION preferred=PREMIUM, budget is low so no degradation
      expect(modelName).toContain("opus");
    });

    it("degrades PROGRAMMER to STANDARD at 60-85% budget", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "cluster-adaptive",
        budgetState: makeBudgetState(0.7),
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName =
        passedConfig.configurable?.programmerModelName as string;
      // Degradation level 1 → PREMIUM drops to STANDARD
      expect(modelName).toContain("sonnet");
    });

    it("degrades PROGRAMMER to min viable (STANDARD) at 85%+ budget", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "cluster-adaptive",
        budgetState: makeBudgetState(0.9),
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName =
        passedConfig.configurable?.programmerModelName as string;
      // Degradation level 2 → PREMIUM drops to ECONOMY but clamped at STANDARD (minViable)
      expect(modelName).toContain("sonnet");
    });

    it("FILE_EXPLORATION stays at ECONOMY regardless of budget", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "cluster-adaptive",
        budgetState: makeBudgetState(0.1),
        lastToolCalls: [{ name: "list_directory" }],
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName =
        passedConfig.configurable?.programmerModelName as string;
      expect(modelName).toContain("haiku");
    });
  });

  describe("fixed-tier strategy", () => {
    it("uses configured tier", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "fixed-tier",
        fixedTier: "standard",
        budgetState: makeBudgetState(0.1),
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName =
        passedConfig.configurable?.programmerModelName as string;
      expect(modelName).toContain("sonnet");
    });

    it("clamps to minViableTier for COMPLEX_REFACTOR (min=PREMIUM)", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "fixed-tier",
        fixedTier: "economy",
        budgetState: makeBudgetState(0.1),
        lastPrompt: "Refactor the entire auth module",
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName =
        passedConfig.configurable?.programmerModelName as string;
      // COMPLEX_REFACTOR has minViable=PREMIUM, so economy gets clamped up
      expect(modelName).toContain("opus");
    });
  });

  describe("task-priority strategy", () => {
    it("always uses PREMIUM for PROGRAMMER", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "task-priority",
        budgetState: makeBudgetState(0.7),
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName =
        passedConfig.configurable?.programmerModelName as string;
      expect(modelName).toContain("opus");
    });

    it("cluster-routes non-PROGRAMMER tasks", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        routingStrategy: "task-priority",
        budgetState: makeBudgetState(0.7),
      });

      await manager.loadModel(config, LLMTask.ROUTER);

      const passedConfig = loadModelMock.mock.calls[0][0] as GraphConfig;
      const modelName = passedConfig.configurable?.routerModelName as string;
      // ROUTING_CLASSIFICATION → ECONOMY preferred, budget at 0.7 means degradation 1
      // but ECONOMY can't degrade further
      expect(modelName).toContain("haiku");
    });
  });

  describe("budget exhaustion", () => {
    it("throws error when budget is exhausted", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        budgetState: makeBudgetState(1.0),
      });

      await expect(
        manager.loadModel(config, LLMTask.PROGRAMMER),
      ).rejects.toThrow(/[Bb]udget exhausted/);
    });
  });

  describe("routing decision tracking", () => {
    it("records last decision", async () => {
      const manager = new ClusterAwareModelManager();
      const config = makeConfig({
        budgetState: makeBudgetState(0.1),
      });

      await manager.loadModel(config, LLMTask.PROGRAMMER);

      const decision = manager.getLastDecision();
      expect(decision).not.toBeNull();
      expect(decision!.cluster).toBe(QueryCluster.CODE_GENERATION);
      expect(decision!.tier).toBe(ModelTier.PREMIUM);
    });
  });

  describe("end-to-end budget progression", () => {
    it("simulates budget progression across multiple calls", async () => {
      const manager = new ClusterAwareModelManager();
      const tiers: string[] = [];

      // Simulate 10 PROGRAMMER calls with increasing budget usage
      for (let i = 0; i < 10; i++) {
        const util = i * 0.1; // 0%, 10%, 20%, ..., 90%
        const config = makeConfig({
          budgetState: makeBudgetState(util),
        });

        await manager.loadModel(config, LLMTask.PROGRAMMER);

        const passedConfig = loadModelMock.mock.calls[i][0] as GraphConfig;
        const modelName =
          passedConfig.configurable?.programmerModelName as string;
        tiers.push(modelName);
      }

      // First 6 calls (0-50% util) should be PREMIUM
      for (let i = 0; i < 6; i++) {
        expect(tiers[i]).toContain("opus");
      }

      // Calls at 60-80% should degrade to STANDARD
      for (let i = 6; i < 9; i++) {
        expect(tiers[i]).toContain("sonnet");
      }

      // Call at 90% should still be STANDARD (clamped at minViable)
      expect(tiers[9]).toContain("sonnet");
    });
  });
});
