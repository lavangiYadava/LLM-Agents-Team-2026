import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { SandboxFailureError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const getSandboxWithErrorHandlingMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

jest.unstable_mockModule("../../../utils/sandbox.js", () => ({
  getSandboxWithErrorHandling: getSandboxWithErrorHandlingMock,
}));

const { handleSandboxFailure } =
  await import("../../../runtime/failure/policies/sandbox-failure.js");

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

describe("handleSandboxFailure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves gracefully when sandbox restarts successfully", async () => {
    const state = makeState();
    getSandboxWithErrorHandlingMock.mockResolvedValue({
      sandbox: { id: "sandbox-1" },
    });

    const outcome = await handleSandboxFailure(
      new SandboxFailureError("sandbox failure", "programmer", 1, 1),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(true);
    expect(outcome.terminationKind).toBe("graceful");
    expect(state.unsolvable).not.toBe(true);
  });

  it("hard stops, sets state.unsolvable, and checkpoints when restart fails", async () => {
    const state = makeState();
    getSandboxWithErrorHandlingMock.mockRejectedValue(
      new Error("restart failed"),
    );

    const outcome = await handleSandboxFailure(
      new SandboxFailureError("sandbox failure", "programmer", 1, 1),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(state.unsolvable).toBe(true);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("outcome message contains the exit code when restart fails", async () => {
    const state = makeState();
    getSandboxWithErrorHandlingMock.mockRejectedValue(
      new Error("restart failed"),
    );

    const outcome = await handleSandboxFailure(
      new SandboxFailureError("sandbox failure", "programmer", 1, 127),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.message).toContain("127");
  });

  it("does not checkpoint when sandbox restarts successfully", async () => {
    const state = makeState();
    getSandboxWithErrorHandlingMock.mockResolvedValue({
      sandbox: { id: "sandbox-1" },
    });

    await handleSandboxFailure(
      new SandboxFailureError("sandbox failure", "programmer", 1, 1),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).not.toHaveBeenCalled();
  });
});
