import { describe, expect, it } from "@jest/globals";
import { evaluateLoopPolicy, LoopPolicyConfig } from "../loop-policy.js";
import { GraphState } from "@openswe/shared/open-swe/types";
import { BudgetState, BudgetStatus } from "@openswe/shared/open-swe/budget-types";

function makeConfig(overrides?: Partial<LoopPolicyConfig>): LoopPolicyConfig {
  return {
    maxActions: 20,
    maxReviewCount: 3,
    maxWallClockMs: 30 * 60 * 1000,
    budgetWarningThreshold: 0.8,
    ...overrides,
  };
}

function makeBudget(
  tokensUsed: number,
  maxTokens: number,
  toolCallsUsed = 0,
  maxToolCalls = 200,
): BudgetState {
  return {
    config: {
      maxBudgetTokens: maxTokens,
      maxBudgetToolCalls: maxToolCalls,
      maxBudgetActions: 150,
    },
    usage: {
      totalTokensUsed: tokensUsed,
      totalToolCallsUsed: toolCallsUsed,
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

describe("evaluateLoopPolicy", () => {
  it("returns continue when no policy is triggered", () => {
    const config = makeConfig();
    const budget = makeBudget(10000, 100000);
    const state = makeState();
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("continue");
  });

  it("returns terminate hard when budget tokens are exhausted", () => {
    const config = makeConfig();
    const budget = makeBudget(100000, 100000);
    const state = makeState();
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("terminate");
    if (result.action === "terminate") {
      expect(result.reason).toBe("budget_exhausted");
      expect(result.mode).toBe("hard");
    }
  });

  it("returns terminate hard when tool calls are exhausted", () => {
    const config = makeConfig();
    const budget = makeBudget(0, 100000, 200, 200);
    const state = makeState();
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("terminate");
    if (result.action === "terminate") {
      expect(result.reason).toBe("budget_exhausted");
      expect(result.mode).toBe("hard");
    }
  });

  it("returns degrade when token utilization hits warning threshold", () => {
    const config = makeConfig({ budgetWarningThreshold: 0.8 });
    const budget = makeBudget(80000, 100000);
    const state = makeState();
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("degrade");
    if (result.action === "degrade") {
      expect(result.reason).toBe("graceful_degradation");
    }
  });

  it("returns terminate graceful when iteration_count hits maxActions", () => {
    const config = makeConfig({ maxActions: 20 });
    const budget = makeBudget(10000, 100000);
    const state = makeState({
      loop_metadata: {
        iteration_count: 20,
        programmer_iterations: 0,
        reviewer_cycles: 0,
        last_node: null,
        termination_reason: null,
        wall_clock_start_ms: Date.now(),
        feasibility_result: null,
      },
    });
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("terminate");
    if (result.action === "terminate") {
      expect(result.reason).toBe("max_iterations");
      expect(result.mode).toBe("graceful");
    }
  });

  it("returns terminate graceful when reviewer_cycles hits maxReviewCount", () => {
    const config = makeConfig({ maxReviewCount: 3 });
    const budget = makeBudget(10000, 100000);
    const state = makeState({
      loop_metadata: {
        iteration_count: 0,
        programmer_iterations: 0,
        reviewer_cycles: 3,
        last_node: null,
        termination_reason: null,
        wall_clock_start_ms: Date.now(),
        feasibility_result: null,
      },
    });
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("terminate");
    if (result.action === "terminate") {
      expect(result.reason).toBe("max_reviewer_cycles");
      expect(result.mode).toBe("graceful");
    }
  });

  it("returns terminate graceful on timeout", () => {
    const maxWallClockMs = 1000;
    const config = makeConfig({ maxWallClockMs });
    const budget = makeBudget(10000, 100000);
    const state = makeState({
      loop_metadata: {
        iteration_count: 0,
        programmer_iterations: 0,
        reviewer_cycles: 0,
        last_node: null,
        termination_reason: null,
        wall_clock_start_ms: Date.now() - (maxWallClockMs + 1),
        feasibility_result: null,
      },
    });
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("terminate");
    if (result.action === "terminate") {
      expect(result.reason).toBe("timeout");
      expect(result.mode).toBe("graceful");
    }
  });

  it("BUDGET_EXHAUSTED takes priority over MAX_ITERATIONS when both triggered", () => {
    const config = makeConfig({ maxActions: 20 });
    const budget = makeBudget(100000, 100000);
    const state = makeState({
      loop_metadata: {
        iteration_count: 20,
        programmer_iterations: 0,
        reviewer_cycles: 0,
        last_node: null,
        termination_reason: null,
        wall_clock_start_ms: Date.now(),
        feasibility_result: null,
      },
    });
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("terminate");
    if (result.action === "terminate") {
      expect(result.reason).toBe("budget_exhausted");
      expect(result.mode).toBe("hard");
    }
  });

  it("GRACEFUL_DEGRADATION takes priority over MAX_ITERATIONS when budget is at warning but iterations also hit max", () => {
    const config = makeConfig({
      maxActions: 20,
      budgetWarningThreshold: 0.8,
    });
    const budget = makeBudget(85000, 100000);
    const state = makeState({
      loop_metadata: {
        iteration_count: 20,
        programmer_iterations: 0,
        reviewer_cycles: 0,
        last_node: null,
        termination_reason: null,
        wall_clock_start_ms: Date.now(),
        feasibility_result: null,
      },
    });
    const result = evaluateLoopPolicy(state, budget, config);
    expect(result.action).toBe("degrade");
    if (result.action === "degrade") {
      expect(result.reason).toBe("graceful_degradation");
    }
  });
});
