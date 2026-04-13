import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolIntegrationError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

const { handleToolIntegration } =
  await import("../../../runtime/failure/policies/tool-integration.js");

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

describe("handleToolIntegration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("switches to backup tool and resolves when fallback exists", async () => {
    const state = makeState();

    const outcome = await handleToolIntegration(
      new ToolIntegrationError("tool failed", "programmer", 1, "bash"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(true);
    expect(outcome.terminationKind).toBe("graceful");
    expect(state.activeToolOverride).toBe("python_repl");
  });

  it("hard stops and checkpoints when no backup tool exists", async () => {
    const state = makeState();

    const outcome = await handleToolIntegration(
      new ToolIntegrationError(
        "tool failed",
        "programmer",
        1,
        "nonexistent-tool-xyz",
      ),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(outcome.stateCheckpointed).toBe(true);
    expect(checkpointStateMock).toHaveBeenCalled();
  });

  it("outcome message contains the tool name when no fallback exists", async () => {
    const state = makeState();

    const outcome = await handleToolIntegration(
      new ToolIntegrationError(
        "tool failed",
        "programmer",
        1,
        "nonexistent-tool-xyz",
      ),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.message).toContain("nonexistent-tool-xyz");
  });

  it("does not checkpoint when fallback exists", async () => {
    const state = makeState();

    await handleToolIntegration(
      new ToolIntegrationError("tool failed", "programmer", 1, "bash"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(checkpointStateMock).not.toHaveBeenCalled();
  });
});
