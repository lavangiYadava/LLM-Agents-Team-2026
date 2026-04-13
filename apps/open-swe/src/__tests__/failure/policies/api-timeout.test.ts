import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ApiTimeoutError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

const { handleApiTimeout } =
  await import("../../../runtime/failure/policies/api-timeout.js");

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

describe("handleApiTimeout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves on first attempt with correct outcome shape", async () => {
    const state = makeState();
    const budget = makeBudgetState();
    const promise = handleApiTimeout(
      new ApiTimeoutError("planner timeout", "planner", 1, 500),
      state,
      makeConfig(),
      budget,
    );

    await jest.runAllTimersAsync();

    const outcome = await promise;

    expect(outcome.resolved).toBe(true);
    expect(outcome.terminationKind).toBe("graceful");
    expect(outcome.stateCheckpointed).toBe(false);
    expect(outcome.message).toContain("Retrying");
    expect(checkpointStateMock).not.toHaveBeenCalled();
  });

  it("advances fake timers for the backoff sleep", async () => {
    const state = makeState();
    const budget = makeBudgetState();
    const promise = handleApiTimeout(
      new ApiTimeoutError("planner timeout", "planner", 1, 500),
      state,
      makeConfig(),
      budget,
    );

    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      resolved: true,
      terminationKind: "graceful",
    });
  });

  it("requests tier downgrade on attempt 2", async () => {
    const state = makeState();
    const budget = makeBudgetState();

    const outcomePromise = handleApiTimeout(
      new ApiTimeoutError("planner timeout", "planner", 2, 500),
      state,
      makeConfig(),
      budget,
    );

    await jest.runAllTimersAsync();

    await outcomePromise;

    expect(budget.requestTierDowngrade).toHaveBeenCalledWith("planner");
  });

  it("requests tier downgrade on attempt 3", async () => {
    const state = makeState();
    const budget = makeBudgetState();

    const outcomePromise = handleApiTimeout(
      new ApiTimeoutError("planner timeout", "planner", 3, 500),
      state,
      makeConfig(),
      budget,
    );

    await jest.runAllTimersAsync();

    await outcomePromise;

    expect(budget.requestTierDowngrade).toHaveBeenCalledWith("planner");
  });

  it("hard stops and checkpoints when attemptCount exceeds MAX_RETRIES", async () => {
    const state = makeState();
    const budget = makeBudgetState();

    const outcome = await handleApiTimeout(
      new ApiTimeoutError("planner timeout", "planner", 4, 500),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(outcome.stateCheckpointed).toBe(true);
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("hard stops and checkpoints when budget is exhausted regardless of attempt count", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      isExhausted: jest.fn().mockReturnValue(true),
    });

    const outcome = await handleApiTimeout(
      new ApiTimeoutError("planner timeout", "planner", 1, 500),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(outcome.stateCheckpointed).toBe(true);
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });
});
