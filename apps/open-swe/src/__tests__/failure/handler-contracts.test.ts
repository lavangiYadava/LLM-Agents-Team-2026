import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  ApiTimeoutError,
  AuthFailureError,
  BudgetExhaustedError,
  ContextOverflowError,
  FailureType,
  LoopOverextensionError,
  MalformedOutputError,
  ModelUnavailableError,
  NetworkFailureError,
  type RecoveryOutcome,
  RateLimitingError,
  SandboxFailureError,
  ToolIntegrationError,
  QualityDegradationError,
  type AgentFailureError,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../runtime/budget/types.js";

const STUB_OUTCOME: RecoveryOutcome = {
  resolved: true,
  terminationKind: "graceful",
  stateCheckpointed: false,
  qualityFlagEmitted: false,
  message: "stub",
};

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

const handleApiTimeoutMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleBudgetExhaustedMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleToolIntegrationMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleQualityDegradationMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleContextOverflowMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleLoopOverextensionMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleModelUnavailableMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleRateLimitingMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleSandboxFailureMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleMalformedOutputMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleAuthFailureMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);
const handleNetworkFailureMock = jest
  .fn<() => Promise<RecoveryOutcome>>()
  .mockResolvedValue(STUB_OUTCOME);

jest.unstable_mockModule("../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

jest.unstable_mockModule(
  "../../runtime/failure/policies/api-timeout.js",
  () => ({
    handleApiTimeout: handleApiTimeoutMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/budget-exhausted.js",
  () => ({
    handleBudgetExhausted: handleBudgetExhaustedMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/tool-integration.js",
  () => ({
    handleToolIntegration: handleToolIntegrationMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/quality-degradation.js",
  () => ({
    handleQualityDegradation: handleQualityDegradationMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/context-overflow.js",
  () => ({
    handleContextOverflow: handleContextOverflowMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/loop-overextension.js",
  () => ({
    handleLoopOverextension: handleLoopOverextensionMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/model-unavailable.js",
  () => ({
    handleModelUnavailable: handleModelUnavailableMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/rate-limiting.js",
  () => ({
    handleRateLimiting: handleRateLimitingMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/sandbox-failure.js",
  () => ({
    handleSandboxFailure: handleSandboxFailureMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/malformed-output.js",
  () => ({
    handleMalformedOutput: handleMalformedOutputMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/auth-failure.js",
  () => ({
    handleAuthFailure: handleAuthFailureMock,
  }),
);

jest.unstable_mockModule(
  "../../runtime/failure/policies/network-failure.js",
  () => ({
    handleNetworkFailure: handleNetworkFailureMock,
  }),
);

const { FailureHandler } = await import("../../runtime/failure/handler.js");

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

const errorFactories: Record<FailureType, () => AgentFailureError> = {
  [FailureType.API_TIMEOUT]: () =>
    new ApiTimeoutError("timeout", "manager", 1, 500),
  [FailureType.BUDGET_EXHAUSTED]: () =>
    new BudgetExhaustedError("budget", "manager", 1, "tokens"),
  [FailureType.TOOL_INTEGRATION]: () =>
    new ToolIntegrationError("tool", "manager", 1, "bash"),
  [FailureType.QUALITY_DEGRADATION]: () =>
    new QualityDegradationError("quality", "manager", 1, "schema"),
  [FailureType.CONTEXT_OVERFLOW]: () =>
    new ContextOverflowError("context", "manager", 1),
  [FailureType.LOOP_OVEREXTENSION]: () =>
    new LoopOverextensionError("loop", "manager", 1, 2),
  [FailureType.MODEL_UNAVAILABLE]: () =>
    new ModelUnavailableError("model", "manager", 1, "claude"),
  [FailureType.RATE_LIMITING]: () =>
    new RateLimitingError("rate", "manager", 1, 200),
  [FailureType.SANDBOX_FAILURE]: () =>
    new SandboxFailureError("sandbox", "manager", 1, 127),
  [FailureType.MALFORMED_OUTPUT]: () =>
    new MalformedOutputError("malformed", "manager", 1, "{"),
  [FailureType.AUTH_FAILURE]: () => new AuthFailureError("auth", "manager", 1),
  [FailureType.NETWORK_FAILURE]: () =>
    new NetworkFailureError("network", "manager", 1),
};

describe("FailureHandler - POLICY_MAP exhaustiveness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has an entry for every value in the FailureType enum", async () => {
    const handler = new FailureHandler(makeBudgetState());
    const failureTypes = Object.values(FailureType);

    for (const failureType of failureTypes) {
      const outcome = await handler.dispatch(
        errorFactories[failureType](),
        makeState(),
        makeConfig(),
      );

      expect(outcome).toEqual({
        resolved: expect.any(Boolean),
        terminationKind: expect.stringMatching(/^(graceful|hard)$/),
        stateCheckpointed: expect.any(Boolean),
        qualityFlagEmitted: expect.any(Boolean),
        message: expect.any(String),
      });
    }
  });
});

describe("FailureHandler - dispatch never throws", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns RecoveryOutcome and never throws for any FailureType", async () => {
    const handler = new FailureHandler(makeBudgetState());

    for (const failureType of Object.values(FailureType)) {
      await expect(
        handler.dispatch(
          errorFactories[failureType](),
          makeState(),
          makeConfig(),
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          resolved: expect.any(Boolean),
          terminationKind: expect.stringMatching(/^(graceful|hard)$/),
          stateCheckpointed: expect.any(Boolean),
          qualityFlagEmitted: expect.any(Boolean),
          message: expect.any(String),
        }),
      );
    }
  });
});

describe("FailureHandler - RecoveryOutcome shape invariant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("always returns an object with all five required RecoveryOutcome fields", async () => {
    const handler = new FailureHandler(makeBudgetState());

    for (const failureType of Object.values(FailureType)) {
      const outcome = await handler.dispatch(
        errorFactories[failureType](),
        makeState(),
        makeConfig(),
      );

      expect(outcome).toEqual(
        expect.objectContaining({
          resolved: expect.any(Boolean),
          terminationKind: expect.stringMatching(/^(graceful|hard)$/),
          stateCheckpointed: expect.any(Boolean),
          qualityFlagEmitted: expect.any(Boolean),
          message: expect.any(String),
        }),
      );
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });
});

describe("FailureHandler - error metadata preserved in logs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not throw when error has originNode and attemptCount set to edge case values", async () => {
    const handler = new FailureHandler(makeBudgetState());

    await expect(
      handler.dispatch(
        new AuthFailureError("auth", "", 0),
        makeState(),
        makeConfig(),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ message: expect.any(String) }),
    );

    await expect(
      handler.dispatch(
        new AuthFailureError("auth", "a".repeat(200), 999),
        makeState(),
        makeConfig(),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
});
