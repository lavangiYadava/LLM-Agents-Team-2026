import { AIMessageChunk } from "@langchain/core/messages";
import {
  BudgetState,
  BudgetStatus,
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_BUDGET_USAGE,
} from "@openswe/shared/open-swe/budget-types";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import {
  initializeBudgetState,
  getOrInitBudgetState,
  recordTokenUsage,
  recordToolCalls,
  recordAction,
  shouldTerminate,
  shouldDegrade,
} from "../utils/budget-tracker.js";

function makeConfig(overrides?: Partial<GraphConfig["configurable"]>): GraphConfig {
  return {
    configurable: {
      ...overrides,
    },
  } as GraphConfig;
}

function makeState(overrides?: Partial<BudgetState>): BudgetState {
  return {
    config: overrides?.config ?? { ...DEFAULT_BUDGET_CONFIG },
    usage: overrides?.usage ?? { ...DEFAULT_BUDGET_USAGE },
    status: overrides?.status ?? BudgetStatus.NORMAL,
    lastUpdatedNode: overrides?.lastUpdatedNode ?? "",
  };
}

function makeMockResponse(
  inputTokens: number,
  outputTokens: number,
): AIMessageChunk {
  return {
    usage_metadata: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
    content: "mock response",
    tool_calls: [],
  } as unknown as AIMessageChunk;
}

describe("initializeBudgetState", () => {
  it("creates state with default config when no overrides", () => {
    const config = makeConfig();
    const state = initializeBudgetState(config);
    expect(state.config.maxBudgetTokens).toBe(
      DEFAULT_BUDGET_CONFIG.maxBudgetTokens,
    );
    expect(state.config.maxBudgetToolCalls).toBe(
      DEFAULT_BUDGET_CONFIG.maxBudgetToolCalls,
    );
    expect(state.config.maxBudgetActions).toBe(
      DEFAULT_BUDGET_CONFIG.maxBudgetActions,
    );
    expect(state.status).toBe(BudgetStatus.NORMAL);
  });

  it("uses config overrides when provided", () => {
    const config = makeConfig({
      maxBudgetTokens: 500_000,
      maxBudgetToolCalls: 50,
      maxBudgetActions: 30,
    });
    const state = initializeBudgetState(config);
    expect(state.config.maxBudgetTokens).toBe(500_000);
    expect(state.config.maxBudgetToolCalls).toBe(50);
    expect(state.config.maxBudgetActions).toBe(30);
  });
});

describe("getOrInitBudgetState", () => {
  it("returns existing state when provided", () => {
    const existing = makeState({ lastUpdatedNode: "test" });
    const config = makeConfig();
    const result = getOrInitBudgetState(existing, config);
    expect(result.lastUpdatedNode).toBe("test");
  });

  it("initializes new state when undefined", () => {
    const config = makeConfig();
    const result = getOrInitBudgetState(undefined, config);
    expect(result.status).toBe(BudgetStatus.NORMAL);
    expect(result.usage.totalTokensUsed).toBe(0);
  });
});

describe("recordTokenUsage", () => {
  it("extracts usage from response and increments tokens", () => {
    const state = makeState();
    const response = makeMockResponse(1000, 500);
    const updated = recordTokenUsage(state, response, "test-node");
    expect(updated.usage.totalTokensUsed).toBe(1500);
    expect(updated.lastUpdatedNode).toBe("test-node");
  });

  it("handles response without usage_metadata", () => {
    const state = makeState();
    const response = { content: "no metadata" } as unknown as AIMessageChunk;
    const updated = recordTokenUsage(state, response, "test-node");
    expect(updated.usage.totalTokensUsed).toBe(0);
  });

  it("accumulates across multiple calls", () => {
    let state = makeState();
    state = recordTokenUsage(state, makeMockResponse(1000, 500), "node1");
    state = recordTokenUsage(state, makeMockResponse(2000, 1000), "node2");
    expect(state.usage.totalTokensUsed).toBe(4500);
    expect(state.lastUpdatedNode).toBe("node2");
  });
});

describe("recordToolCalls", () => {
  it("increments tool call count", () => {
    const state = makeState();
    const updated = recordToolCalls(state, 3, "take-action");
    expect(updated.usage.totalToolCallsUsed).toBe(3);
    expect(updated.lastUpdatedNode).toBe("take-action");
  });

  it("accumulates tool calls across multiple calls", () => {
    let state = makeState();
    state = recordToolCalls(state, 3, "step1");
    state = recordToolCalls(state, 5, "step2");
    expect(state.usage.totalToolCallsUsed).toBe(8);
  });
});

describe("recordAction", () => {
  it("increments action count by 1", () => {
    const state = makeState();
    const updated = recordAction(state, "generate-action");
    expect(updated.usage.totalActionsUsed).toBe(1);
    expect(updated.lastUpdatedNode).toBe("generate-action");
  });
});

describe("shouldTerminate", () => {
  it("returns terminate=false when budget is normal", () => {
    const state = makeState();
    const result = shouldTerminate(state);
    expect(result.terminate).toBe(false);
  });

  it("returns terminate=true when tokens exhausted", () => {
    const state = makeState({
      usage: {
        totalTokensUsed: DEFAULT_BUDGET_CONFIG.maxBudgetTokens,
        totalToolCallsUsed: 0,
        totalActionsUsed: 0,
      },
    });
    const result = shouldTerminate(state);
    expect(result.terminate).toBe(true);
    expect(result.mode).toBe("hard");
  });

  it("returns terminate=true when tool calls exhausted", () => {
    const state = makeState({
      usage: {
        totalTokensUsed: 0,
        totalToolCallsUsed: DEFAULT_BUDGET_CONFIG.maxBudgetToolCalls,
        totalActionsUsed: 0,
      },
    });
    const result = shouldTerminate(state);
    expect(result.terminate).toBe(true);
  });

  it("returns terminate=true when actions exhausted", () => {
    const state = makeState({
      usage: {
        totalTokensUsed: 0,
        totalToolCallsUsed: 0,
        totalActionsUsed: DEFAULT_BUDGET_CONFIG.maxBudgetActions,
      },
    });
    const result = shouldTerminate(state);
    expect(result.terminate).toBe(true);
  });
});

describe("shouldDegrade", () => {
  it("returns false when budget is normal", () => {
    const state = makeState();
    expect(shouldDegrade(state)).toBe(false);
  });

  it("returns false when budget is at warning level", () => {
    const state = makeState({
      usage: {
        totalTokensUsed: Math.ceil(
          DEFAULT_BUDGET_CONFIG.maxBudgetTokens * 0.8,
        ),
        totalToolCallsUsed: 0,
        totalActionsUsed: 0,
      },
    });
    expect(shouldDegrade(state)).toBe(false);
  });

  it("returns true when budget is at degradation level", () => {
    const state = makeState({
      usage: {
        totalTokensUsed: Math.ceil(
          DEFAULT_BUDGET_CONFIG.maxBudgetTokens * 0.9,
        ),
        totalToolCallsUsed: 0,
        totalActionsUsed: 0,
      },
    });
    expect(shouldDegrade(state)).toBe(true);
  });
});
