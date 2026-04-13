import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";
import {
  AgentFailureError,
  ApiTimeoutError,
  FailureType,
  LoopOverextensionError,
  type RecoveryOutcome,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../runtime/budget/types.js";

type DispatchFn = (
  error: AgentFailureError,
  state: GraphState,
  config: RunnableConfig,
) => Promise<RecoveryOutcome>;

const dispatchMock = jest.fn<DispatchFn>();
const FailureHandlerMock = jest.fn(() => ({ dispatch: dispatchMock }));
const loadModelMock = jest.fn<() => Promise<unknown>>();
let classificationErrorToThrow: Error | null = null;

jest.unstable_mockModule("../../runtime/failure/index.js", () => ({
  FailureHandler: FailureHandlerMock,
}));

jest.unstable_mockModule("../../runtime/budget/index.js", () => ({
  getBudgetState: jest.fn(() => makeBudgetState()),
}));

jest.unstable_mockModule("../../utils/llms/index.js", () => ({
  loadModel: loadModelMock,
  supportsParallelToolCallsParam: jest.fn(() => false),
}));

jest.unstable_mockModule("@openswe/shared/open-swe/local-mode", () => ({
  isLocalMode: jest.fn(() => true),
}));

jest.unstable_mockModule(
  "../../graphs/manager/nodes/classify-message/utils.js",
  () => ({
    createClassificationPromptAndToolSchema: jest.fn(() => {
      if (classificationErrorToThrow) {
        throw classificationErrorToThrow;
      }
      return {
        prompt: "prompt",
        schema: {} as unknown,
      };
    }),
  }),
);

const { classifyMessage } =
  await import("../../graphs/manager/nodes/classify-message/index.js");

function getDispatchMock(): jest.Mock<DispatchFn> {
  const value = (FailureHandlerMock as jest.Mock).mock.results.at(-1)?.value as
    | { dispatch: jest.Mock<DispatchFn> }
    | undefined;
  return value?.dispatch ?? dispatchMock;
}

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
    messages: [new HumanMessage({ content: "test request" })],
    internalMessages: [],
    taskPlan: { tasks: [], activeTaskIndex: 0 },
    contextGatheringNotes: "",
    sandboxSessionId: "sandbox-1",
    branchName: "main",
    targetRepository: { owner: "owner", repo: "repo" },
    codebaseTree: "",
    documentCache: {},
    githubIssueId: 0,
    dependenciesInstalled: false,
    reviewsCount: 0,
    ...overrides,
  } as GraphState;
}

function makeOutcome(
  overrides: Partial<RecoveryOutcome> = {},
): RecoveryOutcome {
  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: false,
    message: "ok",
    ...overrides,
  };
}

function getCommandUpdate(command: unknown): Record<string, unknown> {
  return ((command as { update?: Record<string, unknown> }).update ??
    {}) as Record<string, unknown>;
}

class TestAgentFailureError extends AgentFailureError {
  readonly failureType = FailureType.API_TIMEOUT;
}

describe("Manager node - proactive loop overextension check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    classificationErrorToThrow = null;
    dispatchMock.mockResolvedValue(makeOutcome());
    loadModelMock.mockResolvedValue({
      bindTools: jest.fn(() => ({
        invoke: jest.fn(),
      })),
    });
  });

  it("dispatches LoopOverextensionError when reviewerCycleCount >= 2 before core logic runs", async () => {
    const state = makeState({ reviewerCycleCount: 2 });

    await classifyMessage(state as any, makeConfig() as any);

    const dispatchedError = getDispatchMock().mock
      .calls[0]?.[0] as LoopOverextensionError;
    expect(dispatchedError).toBeInstanceOf(LoopOverextensionError);
    expect(dispatchedError.loopCount).toBe(2);
  });

  it("dispatches with loopCount matching the actual reviewerCycleCount value", async () => {
    const state = makeState({ reviewerCycleCount: 5 });

    await classifyMessage(state as any, makeConfig() as any);

    const dispatchedError = getDispatchMock().mock
      .calls[0]?.[0] as LoopOverextensionError;
    expect(dispatchedError).toBeInstanceOf(LoopOverextensionError);
    expect(dispatchedError.loopCount).toBe(5);
  });

  it("returns termination update when loop check dispatch returns resolved: false", async () => {
    dispatchMock.mockResolvedValue(
      makeOutcome({
        resolved: false,
        terminationKind: "hard",
        message: "loop stop",
      }),
    );

    const command = await classifyMessage(
      makeState({ reviewerCycleCount: 2 }) as any,
      makeConfig() as any,
    );
    const update = getCommandUpdate(command);

    expect(update.terminated).toBe(true);
    expect(update.terminationKind).toBe("hard");
    expect(update.terminationMessage).toBe("loop stop");
  });

  it("does not return early when reviewerCycleCount < 2", async () => {
    loadModelMock.mockRejectedValue(new Error("force catch"));

    await classifyMessage(
      makeState({ reviewerCycleCount: 1 }) as any,
      makeConfig() as any,
    );

    const hasLoopError = dispatchMock.mock.calls.some(
      (call) => call[0] instanceof LoopOverextensionError,
    );
    expect(hasLoopError).toBe(false);
  });
});

describe("Manager node - try/catch failure dispatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    classificationErrorToThrow = null;
    dispatchMock.mockResolvedValue(makeOutcome());
  });

  it("dispatches AgentFailureError subclasses thrown by core logic directly", async () => {
    const thrown = new TestAgentFailureError("manager timeout", "manager", 1);
    classificationErrorToThrow = thrown;

    await classifyMessage(makeState() as any, makeConfig() as any);

    expect(dispatchMock.mock.calls[0]?.[0]).toBe(thrown);
  });

  it("wraps unknown non-AgentFailureError errors in ApiTimeoutError before dispatch", async () => {
    loadModelMock.mockRejectedValue(new Error("unexpected crash"));

    await classifyMessage(makeState() as any, makeConfig() as any);

    const dispatchedError = dispatchMock.mock
      .calls[0]?.[0] as AgentFailureError;
    expect(dispatchedError).toBeInstanceOf(ApiTimeoutError);
    expect(dispatchedError.originNode).toBe("manager");
  });

  it("returns termination update when dispatch returns resolved: false", async () => {
    loadModelMock.mockRejectedValue(
      new ApiTimeoutError("manager timeout", "manager", 1, 500),
    );
    dispatchMock.mockResolvedValue(
      makeOutcome({
        resolved: false,
        terminationKind: "graceful",
        stateCheckpointed: true,
        message: "stopping",
      }),
    );

    const command = await classifyMessage(
      makeState() as any,
      makeConfig() as any,
    );
    const update = getCommandUpdate(command);

    expect(update.terminated).toBe(true);
    expect(update.terminationKind).toBe("graceful");
    expect(update.terminationMessage).toBe("stopping");
  });

  it("returns policy signals merged into state delta when dispatch returns resolved: true", async () => {
    const state = makeState({ degradationSignal: "wrap up now" });
    loadModelMock.mockRejectedValue(
      new ApiTimeoutError("manager timeout", "manager", 1, 500),
    );
    dispatchMock.mockImplementation(async () => {
      state.degradationSignal = "wrap up now";
      return makeOutcome({ resolved: true });
    });

    const command = await classifyMessage(state as any, makeConfig() as any);
    const update = getCommandUpdate(command);

    expect(update.degradationSignal).toBe("wrap up now");
  });
});

describe("Manager node - buildTerminationUpdate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    classificationErrorToThrow = null;
    dispatchMock.mockResolvedValue(makeOutcome());
    loadModelMock.mockResolvedValue({
      bindTools: jest.fn(() => ({
        invoke: jest.fn(),
      })),
    });
  });

  it("sets terminated: true in all hard-stop outcomes", async () => {
    dispatchMock.mockResolvedValue(
      makeOutcome({
        resolved: false,
        terminationKind: "hard",
        message: "hard stop",
      }),
    );

    const command = await classifyMessage(
      makeState({ reviewerCycleCount: 2 }) as any,
      makeConfig() as any,
    );
    const update = getCommandUpdate(command);

    expect(update.terminated).toBe(true);
  });

  it("sets terminated: true in all graceful-stop outcomes", async () => {
    dispatchMock.mockResolvedValue(
      makeOutcome({
        resolved: false,
        terminationKind: "graceful",
        message: "graceful stop",
      }),
    );

    const command = await classifyMessage(
      makeState({ reviewerCycleCount: 2 }) as any,
      makeConfig() as any,
    );
    const update = getCommandUpdate(command);

    expect(update.terminated).toBe(true);
  });

  it("includes qualityFlag when qualityFlagEmitted is true", async () => {
    dispatchMock.mockResolvedValue(
      makeOutcome({
        resolved: false,
        qualityFlagEmitted: true,
        message: "quality stop",
      }),
    );

    const command = await classifyMessage(
      makeState({
        reviewerCycleCount: 2,
        qualityFlag: {
          reason: "lint failed",
          emittedAt: "2026-01-01T00:00:00.000Z",
        },
      }) as any,
      makeConfig() as any,
    );
    const update = getCommandUpdate(command);

    expect(update.qualityFlag).toEqual({
      reason: "lint failed",
      emittedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("does not include qualityFlag when qualityFlagEmitted is false", async () => {
    dispatchMock.mockResolvedValue(
      makeOutcome({
        resolved: false,
        qualityFlagEmitted: false,
        message: "quality stop",
      }),
    );

    const command = await classifyMessage(
      makeState({
        reviewerCycleCount: 2,
        qualityFlag: {
          reason: "lint failed",
          emittedAt: "2026-01-01T00:00:00.000Z",
        },
      }) as any,
      makeConfig() as any,
    );
    const update = getCommandUpdate(command);

    expect(update.qualityFlag).toBeUndefined();
  });
});
