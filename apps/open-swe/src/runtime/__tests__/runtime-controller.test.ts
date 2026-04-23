import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { RuntimeController, RuntimeConfig } from "../runtime-controller.js";
import { GraphState, LoopMetadata } from "@openswe/shared/open-swe/types";
import {
  BudgetState,
  BudgetStatus,
} from "@openswe/shared/open-swe/budget-types";
import { FeasibilityResult } from "@openswe/shared/open-swe/types";
import { LoopDecision } from "../loop-policy.js";

function makeConfig(): RuntimeConfig {
  return {
    budget: { maxTokens: 100000, maxToolCalls: 200, maxActions: 150 },
    loop: {
      maxActions: 20,
      maxReviewCount: 3,
      maxWallClockMs: 30 * 60 * 1000,
      budgetWarningThreshold: 0.8,
    },
  };
}

function makeFeasible(feasible = true): FeasibilityResult {
  return {
    estimated_tokens: 1000,
    estimated_tool_calls: 4,
    feasible,
    confidence: feasible ? "high" : "low",
    warning: feasible ? undefined : "exceeds budget",
  };
}

function makeBudget(
  tokensUsed = 10000,
  maxTokens = 100000,
): BudgetState {
  return {
    config: {
      maxBudgetTokens: maxTokens,
      maxBudgetToolCalls: 200,
      maxBudgetActions: 150,
    },
    usage: {
      totalTokensUsed: tokensUsed,
      totalToolCallsUsed: 0,
      totalActionsUsed: 0,
    },
    status: BudgetStatus.NORMAL,
    lastUpdatedNode: "",
  };
}

function makeState(overrides?: Partial<GraphState>): GraphState {
  return {
    messages: [],
    internalMessages: [],
    taskPlan: undefined as unknown as GraphState["taskPlan"],
    ...overrides,
  } as unknown as GraphState;
}

describe("RuntimeController", () => {
  let config: RuntimeConfig;

  beforeEach(() => {
    config = makeConfig();
    jest.restoreAllMocks();
  });

  describe("preRun", () => {
    it("initializes loop_metadata with iteration_count 0 and wall_clock_start_ms set", async () => {
      const feasibleResult = makeFeasible(true);
      const mockCheckFeasibility = jest
        .fn<() => FeasibilityResult>()
        .mockReturnValue(feasibleResult);
      const controller = new RuntimeController(config, mockCheckFeasibility);
      const before = Date.now();
      const meta = await controller.preRun({
        issue_body: "test",
        referenced_file_count: 0,
        repo_line_count: 0,
      });

      expect(meta).toBeDefined();
      expect(meta!.iteration_count).toBe(0);
      expect(meta!.programmer_iterations).toBe(0);
      expect(meta!.reviewer_cycles).toBe(0);
      expect(meta!.last_node).toBeNull();
      expect(meta!.termination_reason).toBeNull();
      expect(meta!.wall_clock_start_ms).toBeGreaterThanOrEqual(before);
      expect(meta!.feasibility_result).toEqual(feasibleResult);
    });

    it("logs a warning when feasibility_result.feasible is false", async () => {
      const infeasibleResult = makeFeasible(false);
      const mockCheckFeasibility = jest
        .fn<() => FeasibilityResult>()
        .mockReturnValue(infeasibleResult);
      const controller = new RuntimeController(config, mockCheckFeasibility);
      const warnSpy = jest.spyOn(
        (controller as unknown as { logger: { warn: () => void } }).logger,
        "warn",
      );

      await controller.preRun({
        issue_body: "test",
        referenced_file_count: 0,
        repo_line_count: 0,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("afterNode", () => {
    it("increments iteration_count on each call", async () => {
      const mockEvaluate = jest
        .fn<() => LoopDecision>()
        .mockReturnValue({ action: "continue" });
      const controller = new RuntimeController(
        config,
        jest.fn<() => FeasibilityResult>().mockReturnValue(makeFeasible()),
        mockEvaluate,
      );
      const budget = makeBudget();
      let state = makeState();

      state = await controller.afterNode(state, budget, "programmer");
      state = await controller.afterNode(state, budget, "programmer");

      expect(state.loop_metadata?.iteration_count).toBe(2);
    });

    it("increments programmer_iterations when completedNodeName is 'programmer'", async () => {
      const mockEvaluate = jest
        .fn<() => LoopDecision>()
        .mockReturnValue({ action: "continue" });
      const controller = new RuntimeController(
        config,
        jest.fn<() => FeasibilityResult>().mockReturnValue(makeFeasible()),
        mockEvaluate,
      );
      const budget = makeBudget();
      const state = makeState();

      const updated = await controller.afterNode(state, budget, "programmer");

      expect(updated.loop_metadata?.programmer_iterations).toBe(1);
    });

    it("increments reviewer_cycles when completedNodeName is 'reviewer'", async () => {
      const mockEvaluate = jest
        .fn<() => LoopDecision>()
        .mockReturnValue({ action: "continue" });
      const controller = new RuntimeController(
        config,
        jest.fn<() => FeasibilityResult>().mockReturnValue(makeFeasible()),
        mockEvaluate,
      );
      const budget = makeBudget();
      const state = makeState();

      const updated = await controller.afterNode(state, budget, "reviewer");

      expect(updated.loop_metadata?.reviewer_cycles).toBe(1);
    });

    it("returns state with termination_reason set when policy returns terminate", async () => {
      const terminateDecision: LoopDecision = {
        action: "terminate",
        reason: "max_iterations",
        mode: "graceful",
      };
      const mockEvaluate = jest
        .fn<() => LoopDecision>()
        .mockReturnValue(terminateDecision);
      const controller = new RuntimeController(
        config,
        jest.fn<() => FeasibilityResult>().mockReturnValue(makeFeasible()),
        mockEvaluate,
      );
      const state = makeState({
        loop_metadata: {
          iteration_count: 19,
          programmer_iterations: 0,
          reviewer_cycles: 0,
          last_node: null,
          termination_reason: null,
          wall_clock_start_ms: Date.now(),
          feasibility_result: null,
        } satisfies LoopMetadata,
      });

      const updated = await controller.afterNode(state, makeBudget(), "planner");

      expect(updated.loop_metadata?.termination_reason).toBe("max_iterations");
    });

    it("afterNode calls telemetry service before policy evaluation", async () => {
      const callOrder: string[] = [];

      const mockEvaluate = jest
        .fn<() => LoopDecision>()
        .mockImplementation(() => {
          callOrder.push("policy");
          return { action: "continue" };
        });
      const controller = new RuntimeController(
        config,
        jest.fn<() => FeasibilityResult>().mockReturnValue(makeFeasible()),
        mockEvaluate,
      );

      const originalInfo = (
        controller as unknown as {
          logger: { info: (...args: unknown[]) => void };
        }
      ).logger.info;
      (
        controller as unknown as {
          logger: { info: (...args: unknown[]) => void };
        }
      ).logger.info = jest.fn().mockImplementation((...args: unknown[]) => {
        callOrder.push("telemetry");
        return originalInfo?.(...args);
      });

      await controller.afterNode(makeState(), makeBudget(), "programmer");

      const telemetryIndex = callOrder.indexOf("telemetry");
      const policyIndex = callOrder.indexOf("policy");
      expect(telemetryIndex).toBeGreaterThanOrEqual(0);
      expect(policyIndex).toBeGreaterThanOrEqual(0);
      expect(telemetryIndex).toBeLessThan(policyIndex);
    });
  });
});
