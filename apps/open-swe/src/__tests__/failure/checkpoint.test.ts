import { describe, expect, it } from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { GraphState } from "@openswe/shared/open-swe/types";
import { checkpointState } from "../../runtime/failure/checkpoint.js";

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
    reviewsCount: 2,
    ...overrides,
  } as GraphState;
}

function makeConfig(overrides: Record<string, unknown> = {}): RunnableConfig {
  return {
    configurable: {
      ...overrides,
    },
  } as RunnableConfig;
}

describe("checkpointState", () => {
  it("writes a CheckpointRecord to config.configurable.failureCheckpoint", async () => {
    const state = makeState();
    const config = makeConfig();

    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as Record<string, unknown>;

    expect(record).toBeDefined();
  });

  it("CheckpointRecord contains checkpointedAt as a valid ISO 8601 string", async () => {
    const state = makeState();
    const config = makeConfig();

    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as { checkpointedAt: string };

    expect(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        record.checkpointedAt,
      ),
    ).toBe(true);
  });

  it("CheckpointRecord.nodeSnapshot reflects active node from config", async () => {
    const state = makeState();
    const config = makeConfig({ currentNode: "programmer" });

    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as { nodeSnapshot: string };
    const snapshot = JSON.parse(record.nodeSnapshot) as {
      currentNode: unknown;
    };

    expect(snapshot.currentNode ?? "unknown").toBe("programmer");
  });

  it("CheckpointRecord.iterationCount reflects the iteration counter from state", async () => {
    const state = makeState({ reviewerCycleCount: 7, reviewsCount: 2 });
    const config = makeConfig();

    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as { iterationCount: number };

    expect(record.iterationCount).toBe(7);
  });

  it("CheckpointRecord.tokenUsage reflects state's token usage field", async () => {
    const tokenUsage = [
      {
        model: "anthropic:claude",
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    ];
    const state = makeState({
      tokenData: tokenUsage as GraphState["tokenData"],
    });
    const config = makeConfig();

    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as { tokenUsage: unknown };

    expect(record.tokenUsage).toEqual(tokenUsage);
  });

  it("does not throw when config.configurable is undefined", async () => {
    const state = makeState();
    const config = {} as RunnableConfig;

    await expect(checkpointState(state, config)).resolves.toBeUndefined();
  });

  it("does not throw when state fields are all undefined/null", async () => {
    const state = {} as GraphState;
    const config = makeConfig();

    await expect(checkpointState(state, config)).resolves.toBeUndefined();
  });

  it("is idempotent - calling twice overwrites with the latest snapshot", async () => {
    const state = makeState({ reviewerCycleCount: 1 });
    const config = makeConfig({ currentNode: "manager" });

    await checkpointState(state, config);

    state.reviewerCycleCount = 9;
    (config.configurable as Record<string, unknown>).currentNode = "programmer";
    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as {
      iterationCount: number;
      nodeSnapshot: string;
    };
    const snapshot = JSON.parse(record.nodeSnapshot) as {
      currentNode: unknown;
    };

    expect(record.iterationCount).toBe(9);
    expect(snapshot.currentNode).toBe("programmer");
  });
});
