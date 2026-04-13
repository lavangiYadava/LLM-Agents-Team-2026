import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ModelUnavailableError } from "@openswe/shared/failure";
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

const { handleModelUnavailable } =
  await import("../../../runtime/failure/policies/model-unavailable.js");

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

describe("handleModelUnavailable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("falls through to next tier and resolves when upgrade is affordable", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      canAffordUpgrade: jest
        .fn<BudgetState["canAffordUpgrade"]>()
        .mockReturnValue(true),
      isExhausted: jest.fn<BudgetState["isExhausted"]>().mockReturnValue(false),
    });

    const outcome = await handleModelUnavailable(
      new ModelUnavailableError(
        "model unavailable",
        "programmer",
        1,
        "claude-3-5-sonnet",
      ),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(true);
    expect(requestTierUpgradeMock).toHaveBeenCalledWith(
      "programmer",
      "model-unavailable",
    );
  });

  it("hard stops and checkpoints when budget is exhausted", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      isExhausted: jest.fn<BudgetState["isExhausted"]>().mockReturnValue(true),
    });

    const outcome = await handleModelUnavailable(
      new ModelUnavailableError(
        "model unavailable",
        "programmer",
        1,
        "claude-3-5-sonnet",
      ),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("hard stops and checkpoints when upgrade is not affordable", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      canAffordUpgrade: jest
        .fn<BudgetState["canAffordUpgrade"]>()
        .mockReturnValue(false),
      isExhausted: jest.fn<BudgetState["isExhausted"]>().mockReturnValue(false),
    });

    const outcome = await handleModelUnavailable(
      new ModelUnavailableError(
        "model unavailable",
        "programmer",
        1,
        "claude-3-5-sonnet",
      ),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(false);
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("outcome message contains the unavailable modelId", async () => {
    const state = makeState();

    const outcome = await handleModelUnavailable(
      new ModelUnavailableError(
        "model unavailable",
        "programmer",
        1,
        "claude-3-5-sonnet",
      ),
      state,
      makeConfig(),
      makeBudgetState({
        canAffordUpgrade: jest
          .fn<BudgetState["canAffordUpgrade"]>()
          .mockReturnValue(true),
        isExhausted: jest
          .fn<BudgetState["isExhausted"]>()
          .mockReturnValue(false),
      }),
    );

    expect(outcome.message).toContain("claude-3-5-sonnet");
  });
});
