import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { BudgetExhaustedError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type {
  BudgetRemaining,
  BudgetState,
} from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

const { handleBudgetExhausted } =
  await import("../../../runtime/failure/policies/budget-exhausted.js");

function makeBudgetState(overrides: Partial<BudgetState> = {}): BudgetState {
  return {
    isExhausted: jest.fn<BudgetState["isExhausted"]>().mockReturnValue(false),
    canAffordUpgrade: jest
      .fn<BudgetState["canAffordUpgrade"]>()
      .mockReturnValue(true),
    canContinue: jest.fn<BudgetState["canContinue"]>().mockReturnValue(true),
    remainingTokenFraction: jest
      .fn<BudgetState["remainingTokenFraction"]>()
      .mockReturnValue(1.0),
    remaining: jest
      .fn<BudgetState["remaining"]>()
      .mockReturnValue({ tokens: 10000, toolCalls: 50, actions: 20 }),
    requestTierDowngrade: jest.fn<BudgetState["requestTierDowngrade"]>(),
    ...overrides,
  };
}

function makeConfig(): RunnableConfig {
  return {
    configurable: {},
  } as RunnableConfig;
}

function makeState(): GraphState {
  return {
    messages: [],
    internalMessages: [],
    taskPlan: { tasks: [], activeTaskIndex: 0 },
    contextGatheringNotes: "",
    sandboxSessionId: "sandbox-1",
    branchName: "main",
    targetRepository: { owner: "owner", repo: "repo" },
    codebaseTree: "",
    documentCache: {},
    githubIssueId: 1,
    dependenciesInstalled: false,
    reviewsCount: 0,
  } as GraphState;
}

describe("handleBudgetExhausted", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("always checkpoints state", async () => {
    const state = makeState();

    await handleBudgetExhausted(
      new BudgetExhaustedError("budget exhausted", "programmer", 1, "tokens"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("always returns graceful termination with resolved false", async () => {
    const state = makeState();

    const outcome = await handleBudgetExhausted(
      new BudgetExhaustedError("budget exhausted", "programmer", 1, "tokens"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("graceful");
    expect(outcome.stateCheckpointed).toBe(true);
  });

  it("sets state.degradationSignal to a non-empty string", async () => {
    const state = makeState();

    await handleBudgetExhausted(
      new BudgetExhaustedError("budget exhausted", "programmer", 1, "tokens"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(typeof state.degradationSignal).toBe("string");
    expect(state.degradationSignal?.length).toBeGreaterThan(0);
  });

  it("degradationSignal contains remaining token count from budget.remaining()", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      remaining: jest
        .fn()
        .mockReturnValue({
          tokens: 4200,
          toolCalls: 12,
          actions: 5,
        }) as jest.MockedFunction<() => BudgetRemaining>,
    });

    await handleBudgetExhausted(
      new BudgetExhaustedError("budget exhausted", "programmer", 1, "tokens"),
      state,
      makeConfig(),
      budget,
    );

    expect(state.degradationSignal).toContain("4200");
  });

  it("degradationSignal contains remaining toolCalls count", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      remaining: jest
        .fn()
        .mockReturnValue({
          tokens: 4200,
          toolCalls: 12,
          actions: 5,
        }) as jest.MockedFunction<() => BudgetRemaining>,
    });

    await handleBudgetExhausted(
      new BudgetExhaustedError("budget exhausted", "programmer", 1, "tokens"),
      state,
      makeConfig(),
      budget,
    );

    expect(state.degradationSignal).toContain("12");
  });

  it("message includes the exhausted dimension", async () => {
    const state = makeState();

    const outcome = await handleBudgetExhausted(
      new BudgetExhaustedError("budget exhausted", "manager", 1, "toolCalls"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.message).toContain("toolCalls");
  });
});
