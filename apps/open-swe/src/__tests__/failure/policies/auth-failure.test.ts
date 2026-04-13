import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AuthFailureError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

const { handleAuthFailure } =
  await import("../../../runtime/failure/policies/auth-failure.js");

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

describe("handleAuthFailure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("always hard stops", async () => {
    const state = makeState();

    const outcome = await handleAuthFailure(
      new AuthFailureError("auth failure", "manager", 1),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("always checkpoints state", async () => {
    const state = makeState();

    const outcome = await handleAuthFailure(
      new AuthFailureError("auth failure", "manager", 1),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.stateCheckpointed).toBe(true);
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("outcome message mentions credential intervention", async () => {
    const state = makeState();

    const outcome = await handleAuthFailure(
      new AuthFailureError("auth failure", "manager", 1),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.message.toLowerCase()).toContain("credential");
    expect(outcome.message.toLowerCase()).toContain("intervention");
  });

  it("does not attempt any retry regardless of budget state", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      isExhausted: jest.fn<BudgetState["isExhausted"]>().mockReturnValue(true),
      canContinue: jest.fn<BudgetState["canContinue"]>().mockReturnValue(false),
    });

    await handleAuthFailure(
      new AuthFailureError("auth failure", "manager", 1),
      state,
      makeConfig(),
      budget,
    );

    expect(budget.isExhausted).not.toHaveBeenCalled();
    expect(budget.canContinue).not.toHaveBeenCalled();
  });
});
