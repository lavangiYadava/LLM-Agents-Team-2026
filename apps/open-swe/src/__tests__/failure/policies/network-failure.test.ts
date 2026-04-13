import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { NetworkFailureError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

const { handleNetworkFailure } =
  await import("../../../runtime/failure/policies/network-failure.js");

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

describe("handleNetworkFailure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves when attempts are within the allowed retry budget", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      remainingTokenFraction: jest
        .fn<BudgetState["remainingTokenFraction"]>()
        .mockReturnValue(1.0),
    });

    const outcome = await handleNetworkFailure(
      new NetworkFailureError("network failure", "planner", 1),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(true);
  });

  it("hard stops and checkpoints when attemptCount exceeds budget-proportional limit", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      remainingTokenFraction: jest
        .fn<BudgetState["remainingTokenFraction"]>()
        .mockReturnValue(0.1),
    });

    const outcome = await handleNetworkFailure(
      new NetworkFailureError("network failure", "planner", 4),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(checkpointStateMock).toHaveBeenCalled();
  });

  it("allowed retry count scales with remaining token fraction", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      remainingTokenFraction: jest
        .fn<BudgetState["remainingTokenFraction"]>()
        .mockReturnValue(0.0),
    });

    const outcome = await handleNetworkFailure(
      new NetworkFailureError("network failure", "planner", 1),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(true);
  });

  it("outcome message contains current attempt number when resolved", async () => {
    const state = makeState();

    const outcome = await handleNetworkFailure(
      new NetworkFailureError("network failure", "planner", 1),
      state,
      makeConfig(),
      makeBudgetState({
        remainingTokenFraction: jest
          .fn<BudgetState["remainingTokenFraction"]>()
          .mockReturnValue(1.0),
      }),
    );

    expect(outcome.message).toContain("1");
  });
});
