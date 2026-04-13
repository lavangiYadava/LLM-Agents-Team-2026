import { describe, expect, it } from "@jest/globals";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { GraphState } from "@openswe/shared/open-swe/types";
import { checkpointState } from "../../runtime/failure/checkpoint.js";

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
    reviewsCount: 2,
  } as GraphState;
}

describe("checkpointState", () => {
  it("writes a CheckpointRecord to config.configurable.failureCheckpoint", async () => {
    const state = createGraphState();
    const config = {
      configurable: { currentNode: "manager" },
    } as RunnableConfig;

    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as Record<string, unknown>;

    expect(record).toBeDefined();
    expect(typeof record.checkpointedAt).toBe("string");
    expect(typeof record.nodeSnapshot).toBe("string");
    expect(record.iterationCount).toBe(2);
    expect(Number.isNaN(Date.parse(record.checkpointedAt as string))).toBe(
      false,
    );
  });

  it("contains checkpointedAt ISO string, nodeSnapshot, and iterationCount", async () => {
    const state = createGraphState();
    state.reviewerCycleCount = 4;
    const config = {
      configurable: { activeNode: "classify-message" },
    } as RunnableConfig;

    await checkpointState(state, config);

    const record = (config.configurable as Record<string, unknown>)[
      "failureCheckpoint"
    ] as {
      checkpointedAt: string;
      nodeSnapshot: string;
      iterationCount: number;
    };

    expect(record.checkpointedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(record.nodeSnapshot).toContain("classify-message");
    expect(record.iterationCount).toBe(4);
  });

  it("does not throw when config.configurable is undefined", async () => {
    const state = createGraphState();
    const config = {} as RunnableConfig;

    await expect(checkpointState(state, config)).resolves.toBeUndefined();
  });
});
