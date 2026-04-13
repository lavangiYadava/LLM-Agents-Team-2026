import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import { MalformedOutputError } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../../runtime/budget/types.js";

const checkpointStateMock = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../../runtime/failure/checkpoint.js", () => ({
  checkpointState: checkpointStateMock,
}));

const { handleMalformedOutput } =
  await import("../../../runtime/failure/policies/malformed-output.js");

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
    remaining: jest
      .fn<BudgetState["remaining"]>()
      .mockReturnValue({ tokens: 10000, toolCalls: 50, actions: 20 }),
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

describe("handleMalformedOutput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves on first attempt", async () => {
    const state = makeState();

    const outcome = await handleMalformedOutput(
      new MalformedOutputError(
        "malformed output",
        "programmer",
        1,
        '{"bad": }',
      ),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(true);
    expect(outcome.terminationKind).toBe("graceful");
    expect(outcome.stateCheckpointed).toBe(false);
  });

  it("sets state.reflexionContext to a non-empty string on first attempt", async () => {
    const state = makeState();

    await handleMalformedOutput(
      new MalformedOutputError(
        "malformed output",
        "programmer",
        1,
        '{"bad": }',
      ),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(typeof state.reflexionContext).toBe("string");
    expect(state.reflexionContext?.length).toBeGreaterThan(0);
  });

  it("reflexionContext contains excerpt of rawOutput (first 500 chars)", async () => {
    const state = makeState();
    const rawOutput = "x".repeat(600);

    await handleMalformedOutput(
      new MalformedOutputError("malformed output", "programmer", 1, rawOutput),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(state.reflexionContext).toContain("x".repeat(500));
    expect(state.reflexionContext).not.toContain(rawOutput);
  });

  it("hard stops and checkpoints on second attempt (Reflexion retry exhausted)", async () => {
    const state = makeState();

    const outcome = await handleMalformedOutput(
      new MalformedOutputError("malformed output", "programmer", 2, "bad"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.terminationKind).toBe("hard");
    expect(outcome.stateCheckpointed).toBe(true);
    expect(checkpointStateMock).toHaveBeenCalledTimes(1);
  });

  it("does not set reflexionContext on second attempt", async () => {
    const state = makeState();

    await handleMalformedOutput(
      new MalformedOutputError("malformed output", "programmer", 2, "bad"),
      state,
      makeConfig(),
      makeBudgetState(),
    );

    expect(state.reflexionContext).toBeUndefined();
  });
});
