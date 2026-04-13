import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ContextOverflowError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const requestTierUpgradeMock =
  jest.fn<(node: string, reason: string) => void>();

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

jest.unstable_mockModule("../../../utils/llms/model-manager.js", () => ({
  getModelManager: () => ({
    requestTierUpgrade: requestTierUpgradeMock,
  }),
}));

const { handleContextOverflow } =
  await import("../../../runtime/failure/policies/context-overflow.js");

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

describe("handleContextOverflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("requests tier upgrade and resolves gracefully when budget allows", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      canAffordUpgrade: jest
        .fn<BudgetState["canAffordUpgrade"]>()
        .mockReturnValue(true),
    });

    const outcome = await handleContextOverflow(
      new ContextOverflowError("context overflow", "planner", 1),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(true);
    expect(outcome.terminationKind).toBe("graceful");
    expect(requestTierUpgradeMock).toHaveBeenCalledWith(
      "planner",
      "context-overflow",
    );
  });

  it("hard stops and checkpoints when budget cannot afford upgrade", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      canAffordUpgrade: jest
        .fn<BudgetState["canAffordUpgrade"]>()
        .mockReturnValue(false),
    });

    const outcome = await handleContextOverflow(
      new ContextOverflowError("context overflow", "planner", 1),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(outcome.stateCheckpointed).toBe(true);
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("does not checkpoint when budget allows upgrade", async () => {
    const state = makeState();

    await handleContextOverflow(
      new ContextOverflowError("context overflow", "planner", 1),
      state,
      makeConfig(),
      makeBudgetState({
        canAffordUpgrade: jest
          .fn<BudgetState["canAffordUpgrade"]>()
          .mockReturnValue(true),
      }),
    );

    expect(checkpointStateMock).not.toHaveBeenCalled();
  });
});
