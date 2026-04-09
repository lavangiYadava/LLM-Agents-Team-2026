import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  ApiTimeoutError,
  AuthFailureError,
  BudgetExhaustedError,
  ContextOverflowError,
  LoopOverextensionError,
  MalformedOutputError,
  ModelUnavailableError,
  NetworkFailureError,
  RateLimitingError,
  SandboxFailureError,
  ToolIntegrationError,
  QualityDegradationError,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../runtime/budget/types.js";

const checkpointStateMock = jest.fn(async () => {});
const getSandboxWithErrorHandlingMock = jest.fn(async () => {
  throw new Error("sandbox unavailable");
});

jest.unstable_mockModule("../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

jest.unstable_mockModule("../../utils/sandbox.js", () => ({
  getSandboxWithErrorHandling: getSandboxWithErrorHandlingMock,
}));

const { FailureHandler } = await import("../../runtime/failure/handler.js");

function createBudgetStateMock(): BudgetState {
  return {
    isExhausted: jest.fn(() => false),
    canAffordUpgrade: jest.fn(() => true),
    canContinue: jest.fn(() => true),
    remainingTokenFraction: jest.fn(() => 1.0),
    remaining: jest.fn(() => ({ tokens: 10000, toolCalls: 50, actions: 20 })),
    requestTierDowngrade: jest.fn(),
  };
}

function createGraphState(): GraphState {
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

function createConfig(): RunnableConfig {
  return { configurable: {} } as RunnableConfig;
}

describe("FailureHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("dispatches each failure type to a concrete policy outcome", async () => {
    const handler = new FailureHandler(createBudgetStateMock());

    const cases = [
      {
        error: new ApiTimeoutError("timeout", "manager", 4, 500),
        expectedMessage: "API timeout: retries exhausted",
      },
      {
        error: new BudgetExhaustedError("budget", "manager", 1, "tokens"),
        expectedMessage: "Budget exhausted (tokens)",
      },
      {
        error: new ToolIntegrationError("tool", "manager", 1, "bash"),
        expectedMessage: "Switched to fallback tool: python_repl",
      },
      {
        error: new QualityDegradationError(
          "quality",
          "manager",
          1,
          "schema drift",
        ),
        expectedMessage: "Tier upgraded for quality retry",
      },
      {
        error: new ContextOverflowError("context", "manager", 1),
        expectedMessage: "Upgrading to higher-context model",
      },
      {
        error: new LoopOverextensionError("loop", "manager", 1, 3),
        expectedMessage: "budget allows one more pass",
      },
      {
        error: new ModelUnavailableError("model", "manager", 1, "claude"),
        expectedMessage: "Falling through from unavailable model claude",
      },
      {
        error: new RateLimitingError("rate", "manager", 1, 31_000),
        expectedMessage: "Rate limit wait exceeds budget",
      },
      {
        error: new SandboxFailureError("sandbox", "manager", 1, 137),
        expectedMessage: "Sandbox unrecoverable (exit 137)",
      },
      {
        error: new MalformedOutputError("malformed", "manager", 1, "{"),
        expectedMessage: "Reflexion retry injected",
      },
      {
        error: new AuthFailureError("auth", "manager", 1),
        expectedMessage: "manual credential intervention required",
      },
      {
        error: new NetworkFailureError("network", "manager", 4),
        expectedMessage: "Network failure: retry budget exhausted",
      },
    ];

    for (const testCase of cases) {
      const state = createGraphState();
      const outcome = await handler.dispatch(
        testCase.error,
        state,
        createConfig(),
      );
      expect(outcome.message).toContain(testCase.expectedMessage);
    }
  });

  it("returns resolved true for API_TIMEOUT on first attempt", async () => {
    jest.useFakeTimers();
    const handler = new FailureHandler(createBudgetStateMock());
    const state = createGraphState();
    const promise = handler.dispatch(
      new ApiTimeoutError("timeout", "manager", 1, 500),
      state,
      createConfig(),
    );
    await jest.advanceTimersByTimeAsync(1000);
    const outcome = await promise;
    expect(outcome.resolved).toBe(true);
    expect(outcome.message).toBe("Retrying (attempt 2)");
    jest.useRealTimers();
  });

  it("returns graceful termination for BUDGET_EXHAUSTED and checkpoints", async () => {
    const handler = new FailureHandler(createBudgetStateMock());
    const state = createGraphState();

    const outcome = await handler.dispatch(
      new BudgetExhaustedError("budget", "manager", 1, "actions"),
      state,
      createConfig(),
    );

    expect(outcome.terminationKind).toBe("graceful");
    expect(outcome.stateCheckpointed).toBe(true);
  });

  it("injects reflexionContext on MALFORMED_OUTPUT first attempt", async () => {
    const handler = new FailureHandler(createBudgetStateMock());
    const state = createGraphState();

    const outcome = await handler.dispatch(
      new MalformedOutputError("malformed", "manager", 1, "raw-output"),
      state,
      createConfig(),
    );

    expect(outcome.resolved).toBe(true);
    expect(state.reflexionContext).toContain("[REFLEXION SIGNAL]");
  });

  it("returns hard termination for AUTH_FAILURE", async () => {
    const handler = new FailureHandler(createBudgetStateMock());
    const state = createGraphState();

    const outcome = await handler.dispatch(
      new AuthFailureError("auth", "manager", 1),
      state,
      createConfig(),
    );

    expect(outcome.terminationKind).toBe("hard");
  });
});
