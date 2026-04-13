import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { RateLimitingError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

const { handleRateLimiting } =
  await import("../../../runtime/failure/policies/rate-limiting.js");

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
    remaining: jest.fn<BudgetState["remaining"]>().mockReturnValue({
      tokens: 10000,
      toolCalls: 50,
      actions: 20,
    }),
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

describe("handleRateLimiting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves after waiting when retryAfterMs is within wall-clock budget", async () => {
    const state = makeState();
    const budget = makeBudgetState();
    const promise = handleRateLimiting(
      new RateLimitingError("rate limited", "programmer", 1, 5000),
      state,
      makeConfig(),
      budget,
    );

    await jest.advanceTimersByTimeAsync(5000);
    const outcome = await promise;

    expect(outcome.resolved).toBe(true);
  });

  it("downgrades tier and resolves immediately when retryAfterMs exceeds MAX_WALL_CLOCK_WAIT_MS", async () => {
    const state = makeState();
    const budget = makeBudgetState();

    const outcome = await handleRateLimiting(
      new RateLimitingError("rate limited", "programmer", 1, 999999),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(true);
    expect(budget.requestTierDowngrade).toHaveBeenCalledWith("programmer");
  });

  it("does not sleep when wait exceeds max", async () => {
    const state = makeState();
    const budget = makeBudgetState();

    await expect(
      handleRateLimiting(
        new RateLimitingError("rate limited", "programmer", 1, 999999),
        state,
        makeConfig(),
        budget,
      ),
    ).resolves.toMatchObject({ resolved: true, terminationKind: "graceful" });
  });

  it("downgrades tier when budget is exhausted regardless of wait time", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      isExhausted: jest.fn<BudgetState["isExhausted"]>().mockReturnValue(true),
    });

    await handleRateLimiting(
      new RateLimitingError("rate limited", "programmer", 1, 1000),
      state,
      makeConfig(),
      budget,
    );

    expect(budget.requestTierDowngrade).toHaveBeenCalledWith("programmer");
  });
});
