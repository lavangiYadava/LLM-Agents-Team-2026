import {
  BudgetConfig,
  BudgetState,
  BudgetStatus,
  BudgetUsage,
  BUDGET_THRESHOLDS,
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_BUDGET_USAGE,
} from "../open-swe/budget-types.js";
import {
  calculateBudgetStatus,
  checkBudget,
  updateBudgetUsage,
  formatBudgetPromptInjection,
  createDefaultBudgetState,
  budgetStateReducer,
} from "../open-swe/budget-enforcement.js";

function makeBudgetState(
  overrides?: Partial<{
    config: Partial<BudgetConfig>;
    usage: Partial<BudgetUsage>;
    status: BudgetStatus;
  }>,
): BudgetState {
  return {
    config: { ...DEFAULT_BUDGET_CONFIG, ...overrides?.config },
    usage: { ...DEFAULT_BUDGET_USAGE, ...overrides?.usage },
    status: overrides?.status ?? BudgetStatus.NORMAL,
    lastUpdatedNode: "",
  };
}

describe("calculateBudgetStatus", () => {
  it("returns NORMAL when usage is low", () => {
    const config = DEFAULT_BUDGET_CONFIG;
    const usage: BudgetUsage = {
      totalTokensUsed: 100_000,
      totalToolCallsUsed: 10,
      totalActionsUsed: 5,
    };
    expect(calculateBudgetStatus(config, usage)).toBe(BudgetStatus.NORMAL);
  });

  it("returns WARNING at 80% token utilization", () => {
    const config = DEFAULT_BUDGET_CONFIG;
    const usage: BudgetUsage = {
      totalTokensUsed: Math.ceil(
        config.maxBudgetTokens * BUDGET_THRESHOLDS.warningThreshold,
      ),
      totalToolCallsUsed: 0,
      totalActionsUsed: 0,
    };
    expect(calculateBudgetStatus(config, usage)).toBe(BudgetStatus.WARNING);
  });

  it("returns DEGRADED at 90% token utilization", () => {
    const config = DEFAULT_BUDGET_CONFIG;
    const usage: BudgetUsage = {
      totalTokensUsed: Math.ceil(
        config.maxBudgetTokens * BUDGET_THRESHOLDS.degradationThreshold,
      ),
      totalToolCallsUsed: 0,
      totalActionsUsed: 0,
    };
    expect(calculateBudgetStatus(config, usage)).toBe(BudgetStatus.DEGRADED);
  });

  it("returns EXHAUSTED at 100% token utilization", () => {
    const config = DEFAULT_BUDGET_CONFIG;
    const usage: BudgetUsage = {
      totalTokensUsed: config.maxBudgetTokens,
      totalToolCallsUsed: 0,
      totalActionsUsed: 0,
    };
    expect(calculateBudgetStatus(config, usage)).toBe(BudgetStatus.EXHAUSTED);
  });

  it("returns WARNING at 80% tool call utilization", () => {
    const config = DEFAULT_BUDGET_CONFIG;
    const usage: BudgetUsage = {
      totalTokensUsed: 0,
      totalToolCallsUsed: Math.ceil(
        config.maxBudgetToolCalls * BUDGET_THRESHOLDS.warningThreshold,
      ),
      totalActionsUsed: 0,
    };
    expect(calculateBudgetStatus(config, usage)).toBe(BudgetStatus.WARNING);
  });

  it("returns EXHAUSTED at 100% action utilization", () => {
    const config = DEFAULT_BUDGET_CONFIG;
    const usage: BudgetUsage = {
      totalTokensUsed: 0,
      totalToolCallsUsed: 0,
      totalActionsUsed: config.maxBudgetActions,
    };
    expect(calculateBudgetStatus(config, usage)).toBe(BudgetStatus.EXHAUSTED);
  });

  it("returns worst-case status across all axes", () => {
    const config = DEFAULT_BUDGET_CONFIG;
    const usage: BudgetUsage = {
      totalTokensUsed: 100,
      totalToolCallsUsed: config.maxBudgetToolCalls,
      totalActionsUsed: 0,
    };
    expect(calculateBudgetStatus(config, usage)).toBe(BudgetStatus.EXHAUSTED);
  });
});

describe("checkBudget", () => {
  it("returns canContinue=true for NORMAL status", () => {
    const state = makeBudgetState();
    const result = checkBudget(state);
    expect(result.canContinue).toBe(true);
    expect(result.status).toBe(BudgetStatus.NORMAL);
  });

  it("returns canContinue=true for WARNING status", () => {
    const state = makeBudgetState({
      usage: {
        totalTokensUsed: Math.ceil(
          DEFAULT_BUDGET_CONFIG.maxBudgetTokens *
            BUDGET_THRESHOLDS.warningThreshold,
        ),
      },
    });
    const result = checkBudget(state);
    expect(result.canContinue).toBe(true);
    expect(result.status).toBe(BudgetStatus.WARNING);
  });

  it("returns canContinue=true for DEGRADED status", () => {
    const state = makeBudgetState({
      usage: {
        totalTokensUsed: Math.ceil(
          DEFAULT_BUDGET_CONFIG.maxBudgetTokens *
            BUDGET_THRESHOLDS.degradationThreshold,
        ),
      },
    });
    const result = checkBudget(state);
    expect(result.canContinue).toBe(true);
    expect(result.status).toBe(BudgetStatus.DEGRADED);
  });

  it("returns canContinue=false for EXHAUSTED status", () => {
    const state = makeBudgetState({
      usage: { totalTokensUsed: DEFAULT_BUDGET_CONFIG.maxBudgetTokens },
    });
    const result = checkBudget(state);
    expect(result.canContinue).toBe(false);
    expect(result.status).toBe(BudgetStatus.EXHAUSTED);
  });

  it("computes utilization percentages correctly", () => {
    const state = makeBudgetState({
      usage: {
        totalTokensUsed: 1_000_000,
        totalToolCallsUsed: 100,
        totalActionsUsed: 75,
      },
    });
    const result = checkBudget(state);
    expect(result.tokenUtilization).toBe(0.5);
    expect(result.toolCallUtilization).toBe(0.5);
    expect(result.actionUtilization).toBe(0.5);
  });
});

describe("updateBudgetUsage", () => {
  it("increments token count correctly", () => {
    const state = makeBudgetState({
      usage: { totalTokensUsed: 100_000 },
    });
    const updated = updateBudgetUsage(state, { totalTokensUsed: 50_000 });
    expect(updated.usage.totalTokensUsed).toBe(150_000);
  });

  it("increments tool calls correctly", () => {
    const state = makeBudgetState({
      usage: { totalToolCallsUsed: 10 },
    });
    const updated = updateBudgetUsage(state, { totalToolCallsUsed: 5 });
    expect(updated.usage.totalToolCallsUsed).toBe(15);
  });

  it("increments actions correctly", () => {
    const state = makeBudgetState({
      usage: { totalActionsUsed: 50 },
    });
    const updated = updateBudgetUsage(state, { totalActionsUsed: 1 });
    expect(updated.usage.totalActionsUsed).toBe(51);
  });

  it("does not modify values not in delta", () => {
    const state = makeBudgetState({
      usage: {
        totalTokensUsed: 100,
        totalToolCallsUsed: 50,
        totalActionsUsed: 25,
      },
    });
    const updated = updateBudgetUsage(state, { totalTokensUsed: 10 });
    expect(updated.usage.totalToolCallsUsed).toBe(50);
    expect(updated.usage.totalActionsUsed).toBe(25);
  });

  it("recalculates status after update", () => {
    const state = makeBudgetState();
    const updated = updateBudgetUsage(state, {
      totalTokensUsed: DEFAULT_BUDGET_CONFIG.maxBudgetTokens,
    });
    expect(updated.status).toBe(BudgetStatus.EXHAUSTED);
  });
});

describe("formatBudgetPromptInjection", () => {
  it("includes budget status in output", () => {
    const state = makeBudgetState();
    const prompt = formatBudgetPromptInjection(state);
    expect(prompt).toContain("NORMAL");
    expect(prompt).toContain("budget_awareness");
  });

  it("includes CRITICAL note for DEGRADED status", () => {
    const state = makeBudgetState({
      usage: {
        totalTokensUsed: Math.ceil(
          DEFAULT_BUDGET_CONFIG.maxBudgetTokens *
            BUDGET_THRESHOLDS.degradationThreshold,
        ),
      },
      status: BudgetStatus.DEGRADED,
    });
    const prompt = formatBudgetPromptInjection(state);
    expect(prompt).toContain("CRITICAL");
  });

  it("includes WARNING note for WARNING status", () => {
    const state = makeBudgetState({
      usage: {
        totalTokensUsed: Math.ceil(
          DEFAULT_BUDGET_CONFIG.maxBudgetTokens *
            BUDGET_THRESHOLDS.warningThreshold,
        ),
      },
      status: BudgetStatus.WARNING,
    });
    const prompt = formatBudgetPromptInjection(state);
    expect(prompt).toContain("WARNING");
  });

  it("shows remaining counts", () => {
    const state = makeBudgetState({
      usage: { totalTokensUsed: 500_000, totalToolCallsUsed: 50 },
    });
    const prompt = formatBudgetPromptInjection(state);
    expect(prompt).toContain("1500000 remaining");
    expect(prompt).toContain("150 remaining");
  });
});

describe("createDefaultBudgetState", () => {
  it("creates state with default config", () => {
    const state = createDefaultBudgetState();
    expect(state.config).toEqual(DEFAULT_BUDGET_CONFIG);
    expect(state.usage).toEqual(DEFAULT_BUDGET_USAGE);
    expect(state.status).toBe(BudgetStatus.NORMAL);
  });

  it("applies config overrides", () => {
    const state = createDefaultBudgetState({ maxBudgetTokens: 500_000 });
    expect(state.config.maxBudgetTokens).toBe(500_000);
    expect(state.config.maxBudgetToolCalls).toBe(
      DEFAULT_BUDGET_CONFIG.maxBudgetToolCalls,
    );
  });
});

describe("budgetStateReducer", () => {
  it("returns update when state is undefined", () => {
    const update = makeBudgetState();
    expect(budgetStateReducer(undefined, update)).toEqual(update);
  });

  it("replaces state with update", () => {
    const state = makeBudgetState();
    const update = makeBudgetState({
      usage: { totalTokensUsed: 999 },
    });
    const result = budgetStateReducer(state, update);
    expect(result.usage.totalTokensUsed).toBe(999);
  });
});
