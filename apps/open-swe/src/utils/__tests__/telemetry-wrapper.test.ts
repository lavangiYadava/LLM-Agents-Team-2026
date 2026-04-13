import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { collectors, timed } from "../telemetry-wrapper.js";

type NodeFnResult = { messages: any[] };

function makeAIMessage(overrides: Record<string, any> = {}) {
  return {
    _getType: () => "ai",
    content: "some output",
    usage_metadata: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

function makeToolMessage(overrides: Record<string, any> = {}) {
  return {
    _getType: () => "tool",
    name: "shell",
    tool_call_id: "call_123",
    content: "success output",
    ...overrides,
  };
}

function makeNodeFn(returnMessages: any[] = []) {
  return jest
    .fn<() => Promise<NodeFnResult>>()
    .mockResolvedValue({ messages: returnMessages });
}

beforeEach(() => {
  collectors.clear();
  jest.restoreAllMocks();
});

describe("timed()", () => {
  describe("passthrough behavior", () => {
    it("calls the underlying node function exactly once", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      expect(nodeFn).toHaveBeenCalledTimes(1);
    });

    it("passes state and config to the underlying function unchanged", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);
      const state = { foo: "bar" };
      const config = {
        configurable: { thread_id: "thread-1" },
        metadata: { ls_model_name: "test-model" },
      };

      await wrapped(state, config);

      expect(nodeFn).toHaveBeenCalledWith(state, config);
    });

    it("returns the result from the underlying function unchanged", async () => {
      const result = { messages: [makeAIMessage()], extra: "value" };
      const nodeFn = jest.fn<() => Promise<typeof result>>().mockResolvedValue(result);
      const wrapped = timed("planner", nodeFn as any);

      const wrappedResult = await wrapped(
        {},
        { configurable: { thread_id: "thread-1" } },
      );

      expect(wrappedResult).toBe(result);
    });
  });

  describe("timing", () => {
    it("records a non-negative wallClockMs", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);
      const config = { configurable: { thread_id: "thread-1" } };

      await wrapped({}, config);

      const summary = collectors.get("thread-1")?.summarize();
      expect(summary).toBeDefined();
      expect(summary?.records[0].wallClockMs).toBeGreaterThanOrEqual(0);
    });

    it("records a wallClockMs that reflects actual elapsed time (mock the node fn to delay ~10ms and assert wallClockMs >= 10)", async () => {
      const nodeFn = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ messages: [makeAIMessage()] }), 15);
          }),
      );
      const wrapped = timed("planner", nodeFn as any);
      const config = { configurable: { thread_id: "thread-1" } };

      await wrapped({}, config);

      const summary = collectors.get("thread-1")?.summarize();
      expect(summary).toBeDefined();
      expect(summary?.records[0].wallClockMs).toBeGreaterThanOrEqual(10);
    });
  });

  describe("token extraction", () => {
    it("reads inputTokens from lastAI.usage_metadata.input_tokens", async () => {
      const nodeFn = makeNodeFn([
        makeAIMessage({
          usage_metadata: { input_tokens: 77, output_tokens: 1 },
        }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.inputTokens).toBe(77);
    });

    it("reads outputTokens from lastAI.usage_metadata.output_tokens", async () => {
      const nodeFn = makeNodeFn([
        makeAIMessage({
          usage_metadata: { input_tokens: 1, output_tokens: 88 },
        }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.outputTokens).toBe(88);
    });

    it("defaults inputTokens to 0 when usage_metadata is absent", async () => {
      const nodeFn = makeNodeFn([makeAIMessage({ usage_metadata: undefined })]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.inputTokens).toBe(0);
    });

    it("defaults outputTokens to 0 when no AIMessage is in result messages", async () => {
      const nodeFn = makeNodeFn([makeToolMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.outputTokens).toBe(0);
    });

    it("uses the LAST AIMessage in the messages array when multiple exist", async () => {
      const nodeFn = makeNodeFn([
        makeAIMessage({
          usage_metadata: { input_tokens: 11, output_tokens: 22 },
        }),
        makeToolMessage(),
        makeAIMessage({
          usage_metadata: { input_tokens: 33, output_tokens: 44 },
        }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.inputTokens).toBe(33);
      expect(record?.outputTokens).toBe(44);
    });
  });

  describe("tool event extraction", () => {
    it("creates one toolEvent per ToolMessage in result messages", async () => {
      const nodeFn = makeNodeFn([makeToolMessage(), makeToolMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.toolEvents).toHaveLength(2);
    });

    it("uses m.name as toolName when present", async () => {
      const nodeFn = makeNodeFn([
        makeToolMessage({ name: "grep", tool_call_id: "call-x" }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const toolEvent = collectors.get("thread-1")?.summarize().records[0]
        .toolEvents[0];
      expect(toolEvent?.toolName).toBe("grep");
    });

    it("falls back to m.tool_call_id as toolName when name is absent", async () => {
      const nodeFn = makeNodeFn([
        makeToolMessage({ name: undefined, tool_call_id: "call-fallback" }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const toolEvent = collectors.get("thread-1")?.summarize().records[0]
        .toolEvents[0];
      expect(toolEvent?.toolName).toBe("call-fallback");
    });

    it("falls back to 'unknown' when both name and tool_call_id are absent", async () => {
      const nodeFn = makeNodeFn([
        makeToolMessage({ name: undefined, tool_call_id: undefined }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const toolEvent = collectors.get("thread-1")?.summarize().records[0]
        .toolEvents[0];
      expect(toolEvent?.toolName).toBe("unknown");
    });

    it("sets success: false when ToolMessage content starts with 'Error'", async () => {
      const nodeFn = makeNodeFn([
        makeToolMessage({ content: "Error: failed" }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const toolEvent = collectors.get("thread-1")?.summarize().records[0]
        .toolEvents[0];
      expect(toolEvent?.success).toBe(false);
    });

    it("sets success: true when ToolMessage content does not start with 'Error'", async () => {
      const nodeFn = makeNodeFn([makeToolMessage({ content: "all good" })]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const toolEvent = collectors.get("thread-1")?.summarize().records[0]
        .toolEvents[0];
      expect(toolEvent?.success).toBe(true);
    });

    it("sets success: true when ToolMessage content is not a string", async () => {
      const nodeFn = makeNodeFn([
        makeToolMessage({ content: { structured: true } }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const toolEvent = collectors.get("thread-1")?.summarize().records[0]
        .toolEvents[0];
      expect(toolEvent?.success).toBe(true);
    });

    it("records zero toolEvents when no ToolMessages are in result messages", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.toolEvents).toEqual([]);
    });
  });

  describe("outputSnapshot", () => {
    it("captures the first 200 characters of the last AIMessage content", async () => {
      const longContent = "a".repeat(250);
      const nodeFn = makeNodeFn([makeAIMessage({ content: longContent })]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.outputSnapshot).toBe(longContent.slice(0, 200));
      expect(record?.outputSnapshot.length).toBe(200);
    });

    it("captures the full content when it is shorter than 200 characters", async () => {
      const shortContent = "short content";
      const nodeFn = makeNodeFn([makeAIMessage({ content: shortContent })]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.outputSnapshot).toBe(shortContent);
    });

    it("returns empty string when no AIMessage is present", async () => {
      const nodeFn = makeNodeFn([makeToolMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.outputSnapshot).toBe("");
    });

    it("returns empty string when lastAI.content is not a string", async () => {
      const nodeFn = makeNodeFn([
        makeAIMessage({ content: { rich: "content" } }),
      ]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-1" } });

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.outputSnapshot).toBe("");
    });
  });

  describe("collector lifecycle", () => {
    it("creates a new TelemetryCollector for a new thread_id", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-a" } });

      expect(collectors.has("thread-a")).toBe(true);
    });

    it("reuses the same TelemetryCollector for the same thread_id across calls", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);
      const config = { configurable: { thread_id: "thread-a" } };

      await wrapped({}, config);
      const firstCollector = collectors.get("thread-a");
      await wrapped({}, config);
      const secondCollector = collectors.get("thread-a");

      expect(firstCollector).toBe(secondCollector);
    });

    it("creates separate collectors for different thread_ids", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, { configurable: { thread_id: "thread-a" } });
      await wrapped({}, { configurable: { thread_id: "thread-b" } });

      expect(collectors.get("thread-a")).not.toBe(collectors.get("thread-b"));
      expect(collectors.size).toBe(2);
    });

    it("uses a random UUID as runId when thread_id is absent from config", async () => {
      const uuidSpy = jest
        .spyOn(crypto, "randomUUID")
        .mockReturnValue("123e4567-e89b-12d3-a456-426614174000");
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped({}, {});

      expect(uuidSpy).toHaveBeenCalledTimes(1);
      expect(collectors.has("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
      expect(
        collectors
          .get("123e4567-e89b-12d3-a456-426614174000")
          ?.summarize().runId,
      ).toBe("123e4567-e89b-12d3-a456-426614174000");
    });

    it("increments step by 1 on each successive call for the same thread_id", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);
      const config = { configurable: { thread_id: "thread-a" } };

      await wrapped({}, config);
      await wrapped({}, config);
      await wrapped({}, config);

      const records = collectors.get("thread-a")?.summarize().records ?? [];
      expect(records[0].step).toBe(0);
      expect(records[1].step).toBe(1);
      expect(records[2].step).toBe(2);
    });
  });

  describe("modelId", () => {
    it("reads modelId from config.metadata.ls_model_name when present", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped(
        {},
        {
          configurable: { thread_id: "thread-1" },
          metadata: { ls_model_name: "claude-3-5-sonnet" },
        },
      );

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.modelId).toBe("claude-3-5-sonnet");
    });

    it("defaults modelId to 'unknown' when ls_model_name is absent", async () => {
      const nodeFn = makeNodeFn([makeAIMessage()]);
      const wrapped = timed("planner", nodeFn as any);

      await wrapped(
        {},
        { configurable: { thread_id: "thread-1" }, metadata: {} },
      );

      const record = collectors.get("thread-1")?.summarize().records[0];
      expect(record?.modelId).toBe("unknown");
    });
  });
});
