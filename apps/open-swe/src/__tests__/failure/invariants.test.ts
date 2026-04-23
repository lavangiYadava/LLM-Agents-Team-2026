import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  ApiTimeoutError,
  AuthFailureError,
  BudgetExhaustedError,
  ContextOverflowError,
  MalformedOutputError,
  ModelUnavailableError,
  NetworkFailureError,
  QualityDegradationError,
  RateLimitingError,
  SandboxFailureError,
  ToolIntegrationError,
  LoopOverextensionError,
  type RecoveryOutcome,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const requestTierUpgradeMock =
  jest.fn<(node: string, reason: string) => void>();
const getSandboxWithErrorHandlingMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

jest.unstable_mockModule("../../utils/llms/model-manager.js", () => ({
  getModelManager: () => ({
    requestTierUpgrade: requestTierUpgradeMock,
  }),
}));

jest.unstable_mockModule("../../utils/sandbox.js", () => ({
  getSandboxWithErrorHandling: getSandboxWithErrorHandlingMock,
}));

const { handleApiTimeout } =
  await import("../../runtime/failure/policies/api-timeout.js");
const { handleBudgetExhausted } =
  await import("../../runtime/failure/policies/budget-exhausted.js");
const { handleMalformedOutput } =
  await import("../../runtime/failure/policies/malformed-output.js");
const { handleContextOverflow } =
  await import("../../runtime/failure/policies/context-overflow.js");
const { handleModelUnavailable } =
  await import("../../runtime/failure/policies/model-unavailable.js");
const { handleSandboxFailure } =
  await import("../../runtime/failure/policies/sandbox-failure.js");
const { handleToolIntegration } =
  await import("../../runtime/failure/policies/tool-integration.js");
const { handleAuthFailure } =
  await import("../../runtime/failure/policies/auth-failure.js");
const { handleNetworkFailure } =
  await import("../../runtime/failure/policies/network-failure.js");
const { handleLoopOverextension } =
  await import("../../runtime/failure/policies/loop-overextension.js");
const { handleRateLimiting } =
  await import("../../runtime/failure/policies/rate-limiting.js");
const { handleQualityDegradation } =
  await import("../../runtime/failure/policies/quality-degradation.js");

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

function makeState(overrides: Partial<GraphState> = {}): GraphState {
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
    ...overrides,
  } as GraphState;
}

describe("Cross-cutting invariant - hard termination always checkpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSandboxWithErrorHandlingMock.mockReset();
  });

  it("checkpoints state for every hard-termination path in api-timeout", async () => {
    const outcome = await handleApiTimeout(
      new ApiTimeoutError("timeout", "planner", 4, 500),
      makeState(),
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("checkpoints state for every hard-termination path in malformed-output", async () => {
    const outcome = await handleMalformedOutput(
      new MalformedOutputError("malformed", "programmer", 2, "bad"),
      makeState(),
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("checkpoints state for every hard-termination path in context-overflow", async () => {
    const outcome = await handleContextOverflow(
      new ContextOverflowError("context", "planner", 1),
      makeState(),
      makeConfig(),
      makeBudgetState({
        canAffordUpgrade: jest
          .fn<BudgetState["canAffordUpgrade"]>()
          .mockReturnValue(false),
      }),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("checkpoints state for every hard-termination path in model-unavailable", async () => {
    const outcome = await handleModelUnavailable(
      new ModelUnavailableError("model", "programmer", 1, "claude"),
      makeState(),
      makeConfig(),
      makeBudgetState({
        isExhausted: jest
          .fn<BudgetState["isExhausted"]>()
          .mockReturnValue(true),
      }),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("checkpoints state for every hard-termination path in sandbox-failure", async () => {
    getSandboxWithErrorHandlingMock.mockRejectedValue(
      new Error("restart failed"),
    );

    const outcome = await handleSandboxFailure(
      new SandboxFailureError("sandbox", "programmer", 1, 127),
      makeState(),
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("checkpoints state for every hard-termination path in tool-integration", async () => {
    const outcome = await handleToolIntegration(
      new ToolIntegrationError("tool", "programmer", 1, "nonexistent-tool-xyz"),
      makeState(),
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("checkpoints state for every hard-termination path in auth-failure", async () => {
    const outcome = await handleAuthFailure(
      new AuthFailureError("auth", "manager", 1),
      makeState(),
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });

  it("checkpoints state for every hard-termination path in network-failure", async () => {
    const outcome = await handleNetworkFailure(
      new NetworkFailureError("network", "planner", 4),
      makeState(),
      makeConfig(),
      makeBudgetState({
        remainingTokenFraction: jest
          .fn<BudgetState["remainingTokenFraction"]>()
          .mockReturnValue(0.1),
      }),
    );

    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
    expect(outcome.stateCheckpointed).toBe(true);
    expect(outcome.terminationKind).toBe("hard");
  });
});

describe("Cross-cutting invariant - stateCheckpointed matches actual checkpointState calls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSandboxWithErrorHandlingMock.mockReset();
  });

  const cases: Array<{
    name: string;
    expectedStateCheckpointed: boolean;
    run: () => Promise<RecoveryOutcome>;
  }> = [
    {
      name: "api-timeout hard path",
      expectedStateCheckpointed: true,
      run: () =>
        handleApiTimeout(
          new ApiTimeoutError("timeout", "planner", 4, 500),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "api-timeout graceful retry path",
      expectedStateCheckpointed: false,
      run: async () => {
        jest.useFakeTimers();
        const promise = handleApiTimeout(
          new ApiTimeoutError("timeout", "planner", 1, 500),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        );
        await jest.runAllTimersAsync();
        return promise;
      },
    },
    {
      name: "budget-exhausted path",
      expectedStateCheckpointed: true,
      run: () =>
        handleBudgetExhausted(
          new BudgetExhaustedError("budget", "programmer", 1, "tokens"),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "malformed-output hard path",
      expectedStateCheckpointed: true,
      run: () =>
        handleMalformedOutput(
          new MalformedOutputError("malformed", "programmer", 2, "bad"),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "malformed-output graceful path",
      expectedStateCheckpointed: false,
      run: () =>
        handleMalformedOutput(
          new MalformedOutputError("malformed", "programmer", 1, "{}"),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "context-overflow hard path",
      expectedStateCheckpointed: true,
      run: () =>
        handleContextOverflow(
          new ContextOverflowError("context", "planner", 1),
          makeState(),
          makeConfig(),
          makeBudgetState({
            canAffordUpgrade: jest
              .fn<BudgetState["canAffordUpgrade"]>()
              .mockReturnValue(false),
          }),
        ),
    },
    {
      name: "context-overflow graceful path",
      expectedStateCheckpointed: false,
      run: () =>
        handleContextOverflow(
          new ContextOverflowError("context", "planner", 1),
          makeState(),
          makeConfig(),
          makeBudgetState({
            canAffordUpgrade: jest
              .fn<BudgetState["canAffordUpgrade"]>()
              .mockReturnValue(true),
          }),
        ),
    },
    {
      name: "model-unavailable hard path",
      expectedStateCheckpointed: true,
      run: () =>
        handleModelUnavailable(
          new ModelUnavailableError("model", "programmer", 1, "claude"),
          makeState(),
          makeConfig(),
          makeBudgetState({
            isExhausted: jest
              .fn<BudgetState["isExhausted"]>()
              .mockReturnValue(true),
          }),
        ),
    },
    {
      name: "model-unavailable graceful path",
      expectedStateCheckpointed: false,
      run: () =>
        handleModelUnavailable(
          new ModelUnavailableError("model", "programmer", 1, "claude"),
          makeState(),
          makeConfig(),
          makeBudgetState({
            canAffordUpgrade: jest
              .fn<BudgetState["canAffordUpgrade"]>()
              .mockReturnValue(true),
            isExhausted: jest
              .fn<BudgetState["isExhausted"]>()
              .mockReturnValue(false),
          }),
        ),
    },
    {
      name: "sandbox-failure hard path",
      expectedStateCheckpointed: true,
      run: async () => {
        getSandboxWithErrorHandlingMock.mockRejectedValue(
          new Error("restart failed"),
        );
        return handleSandboxFailure(
          new SandboxFailureError("sandbox", "programmer", 1, 127),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        );
      },
    },
    {
      name: "sandbox-failure graceful path",
      expectedStateCheckpointed: false,
      run: async () => {
        getSandboxWithErrorHandlingMock.mockResolvedValue({
          sandbox: { id: "sandbox-1" },
        });
        return handleSandboxFailure(
          new SandboxFailureError("sandbox", "programmer", 1, 1),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        );
      },
    },
    {
      name: "tool-integration hard path",
      expectedStateCheckpointed: true,
      run: () =>
        handleToolIntegration(
          new ToolIntegrationError(
            "tool",
            "programmer",
            1,
            "nonexistent-tool-xyz",
          ),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "tool-integration graceful path",
      expectedStateCheckpointed: false,
      run: () =>
        handleToolIntegration(
          new ToolIntegrationError("tool", "programmer", 1, "bash"),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "auth-failure path",
      expectedStateCheckpointed: true,
      run: () =>
        handleAuthFailure(
          new AuthFailureError("auth", "manager", 1),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "network-failure hard path",
      expectedStateCheckpointed: true,
      run: () =>
        handleNetworkFailure(
          new NetworkFailureError("network", "planner", 4),
          makeState(),
          makeConfig(),
          makeBudgetState({
            remainingTokenFraction: jest
              .fn<BudgetState["remainingTokenFraction"]>()
              .mockReturnValue(0.1),
          }),
        ),
    },
    {
      name: "network-failure graceful path",
      expectedStateCheckpointed: false,
      run: () =>
        handleNetworkFailure(
          new NetworkFailureError("network", "planner", 1),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "loop-overextension graceful continue path",
      expectedStateCheckpointed: false,
      run: () =>
        handleLoopOverextension(
          new LoopOverextensionError("loop", "manager", 1, 2),
          makeState(),
          makeConfig(),
          makeBudgetState({
            canContinue: jest
              .fn<BudgetState["canContinue"]>()
              .mockReturnValue(true),
          }),
        ),
    },
    {
      name: "rate-limiting graceful path",
      expectedStateCheckpointed: false,
      run: () =>
        handleRateLimiting(
          new RateLimitingError("rate", "programmer", 1, 999999),
          makeState(),
          makeConfig(),
          makeBudgetState(),
        ),
    },
    {
      name: "quality-degradation can-upgrade path",
      expectedStateCheckpointed: false,
      run: () =>
        handleQualityDegradation(
          new QualityDegradationError("quality", "reviewer", 1, "lint failed"),
          makeState(),
          makeConfig(),
          makeBudgetState({
            canAffordUpgrade: jest
              .fn<BudgetState["canAffordUpgrade"]>()
              .mockReturnValue(true),
          }),
        ),
    },
    {
      name: "quality-degradation no-upgrade path",
      expectedStateCheckpointed: false,
      run: () =>
        handleQualityDegradation(
          new QualityDegradationError("quality", "reviewer", 1, "lint failed"),
          makeState(),
          makeConfig(),
          makeBudgetState({
            canAffordUpgrade: jest
              .fn<BudgetState["canAffordUpgrade"]>()
              .mockReturnValue(false),
          }),
        ),
    },
  ];

  it.each(cases)(
    "checkpoint behavior matches stateCheckpointed for %s",
    async ({ expectedStateCheckpointed, run }) => {
      const outcome = await run();

      expect(outcome.stateCheckpointed).toBe(expectedStateCheckpointed);
      if (outcome.stateCheckpointed) {
        expect(checkpointStateMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      } else {
        expect(checkpointStateMock).not.toHaveBeenCalled();
      }
      jest.useRealTimers();
    },
  );
});

describe("Cross-cutting invariant - qualityFlagEmitted consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("state.qualityFlag is defined when qualityFlagEmitted is true", async () => {
    const state = makeState();

    const outcome = await handleQualityDegradation(
      new QualityDegradationError(
        "quality",
        "reviewer",
        1,
        "type check failed",
      ),
      state,
      makeConfig(),
      makeBudgetState({
        canAffordUpgrade: jest
          .fn<BudgetState["canAffordUpgrade"]>()
          .mockReturnValue(false),
      }),
    );

    expect(outcome.qualityFlagEmitted).toBe(true);
    expect(state.qualityFlag).toBeDefined();
    expect((state.qualityFlag?.reason ?? "").length).toBeGreaterThan(0);
    expect(state.qualityFlag?.emittedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("state.qualityFlag is not set when qualityFlagEmitted is false", async () => {
    const state = makeState();

    const outcome = await handleQualityDegradation(
      new QualityDegradationError(
        "quality",
        "reviewer",
        1,
        "type check failed",
      ),
      state,
      makeConfig(),
      makeBudgetState({
        canAffordUpgrade: jest
          .fn<BudgetState["canAffordUpgrade"]>()
          .mockReturnValue(true),
      }),
    );

    expect(outcome.qualityFlagEmitted).toBe(false);
    expect(state.qualityFlag).toBeUndefined();
  });
});
