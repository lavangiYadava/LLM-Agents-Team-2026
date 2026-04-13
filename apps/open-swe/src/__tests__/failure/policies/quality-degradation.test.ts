import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { QualityDegradationError } from "@openswe/shared/failure";
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

const { handleQualityDegradation } =
  await import("../../../runtime/failure/policies/quality-degradation.js");

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

describe("handleQualityDegradation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("requests tier upgrade and resolves when budget allows upgrade", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      canAffordUpgrade: jest
        .fn<BudgetState["canAffordUpgrade"]>()
        .mockReturnValue(true),
    });

    const outcome = await handleQualityDegradation(
      new QualityDegradationError(
        "quality degraded",
        "reviewer",
        1,
        "type check failed",
      ),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(true);
    expect(outcome.qualityFlagEmitted).toBe(false);
    expect(requestTierUpgradeMock).toHaveBeenCalledWith(
      "reviewer",
      "quality-degradation",
    );
  });

  it("emits quality flag and resolves when budget does not allow upgrade", async () => {
    const state = makeState();
    const budget = makeBudgetState({
      canAffordUpgrade: jest
        .fn<BudgetState["canAffordUpgrade"]>()
        .mockReturnValue(false),
    });

    const outcome = await handleQualityDegradation(
      new QualityDegradationError(
        "quality degraded",
        "reviewer",
        1,
        "type check failed",
      ),
      state,
      makeConfig(),
      budget,
    );

    expect(outcome.resolved).toBe(true);
    expect(outcome.qualityFlagEmitted).toBe(true);
    expect(state.qualityFlag).toBeDefined();
    expect(state.qualityFlag?.reason).toBe("type check failed");
    expect(Number.isNaN(Date.parse(state.qualityFlag?.emittedAt ?? ""))).toBe(
      false,
    );
  });

  it("does not call checkpointState in either branch", async () => {
    const upgradeState = makeState();
    await handleQualityDegradation(
      new QualityDegradationError(
        "quality degraded",
        "reviewer",
        1,
        "type check failed",
      ),
      upgradeState,
      makeConfig(),
      makeBudgetState({
        canAffordUpgrade: jest
          .fn<BudgetState["canAffordUpgrade"]>()
          .mockReturnValue(true),
      }),
    );

    const noUpgradeState = makeState();
    await handleQualityDegradation(
      new QualityDegradationError(
        "quality degraded",
        "reviewer",
        1,
        "type check failed",
      ),
      noUpgradeState,
      makeConfig(),
      makeBudgetState({
        canAffordUpgrade: jest
          .fn<BudgetState["canAffordUpgrade"]>()
          .mockReturnValue(false),
      }),
    );

    expect(checkpointStateMock).not.toHaveBeenCalled();
  });
});
