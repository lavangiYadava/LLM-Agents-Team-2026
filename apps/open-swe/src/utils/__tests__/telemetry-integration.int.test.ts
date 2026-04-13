import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { collectors, timed } from "../telemetry-wrapper.js";

beforeEach(() => collectors.clear());

describe("telemetry integration", () => {
  it("produces a valid RunSummary after a single node invocation", async () => {
    const THREAD_ID = "integration-test-thread";

    const fakeNode = jest.fn<() => Promise<any>>().mockResolvedValue({
      messages: [
        {
          _getType: () => "tool",
          name: "shell",
          tool_call_id: "call_1",
          content: "ok",
        },
        {
          _getType: () => "ai",
          content: "I have completed the task",
          usage_metadata: { input_tokens: 50, output_tokens: 25 },
        },
      ],
    });

    const wrappedNode = timed("programmer", fakeNode as any);
    const fakeConfig = {
      configurable: { thread_id: THREAD_ID },
      metadata: { ls_model_name: "claude-3-haiku" },
    };

    const TestState = Annotation.Root({
      messages: Annotation<any[]>({
        reducer: (_state, update) => update,
        default: () => [],
      }),
    });

    const graph = new StateGraph(TestState)
      .addNode("single", wrappedNode)
      .addEdge(START, "single")
      .addEdge("single", END)
      .compile();

    await graph.invoke({ messages: [] }, fakeConfig as any);

    const collector = collectors.get(THREAD_ID);
    expect(collector).toBeDefined();

    const summary = collector!.summarize();

    expect(summary.runId).toBe(THREAD_ID);
    expect(summary.records).toHaveLength(1);
    expect(summary.totalInputTokens).toBe(50);
    expect(summary.totalOutputTokens).toBe(25);
    expect(summary.totalToolCalls).toBe(1);
    expect(summary.totalToolFailures).toBe(0);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);

    const record = summary.records[0];
    expect(record.node).toBe("programmer");
    expect(record.modelId).toBe("claude-3-haiku");
    expect(record.outputSnapshot).toBe("I have completed the task");
    expect(record.toolEvents[0]).toEqual({ toolName: "shell", success: true });
  });
});
