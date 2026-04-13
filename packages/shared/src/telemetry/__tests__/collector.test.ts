import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { TelemetryCollector } from "../collector.js";
import type { NodeRecord } from "../types.js";

afterEach(() => {
  jest.restoreAllMocks();
});

function makeRecord(overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    runId: "test-run",
    node: "planner",
    step: 0,
    wallClockMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    toolEvents: [],
    outputSnapshot: "",
    modelId: "claude-3-haiku",
    modelTier: undefined,
    ...overrides,
  };
}

describe("TelemetryCollector", () => {
  describe("record() and recordCount()", () => {
    it("starts with a recordCount of 0", () => {
      const collector = new TelemetryCollector("run-1");

      expect(collector.recordCount()).toBe(0);
    });

    it("increments recordCount by 1 after each record() call", () => {
      const collector = new TelemetryCollector("run-1");

      collector.record(makeRecord({ step: 1 }));
      expect(collector.recordCount()).toBe(1);

      collector.record(makeRecord({ step: 2 }));
      expect(collector.recordCount()).toBe(2);
    });

    it("stores records in the order they were added", () => {
      const collector = new TelemetryCollector("run-1");
      const first = makeRecord({ step: 1, node: "manager" });
      const second = makeRecord({ step: 2, node: "planner" });
      const third = makeRecord({ step: 3, node: "programmer" });

      collector.record(first);
      collector.record(second);
      collector.record(third);

      expect(collector.summarize().records).toEqual([first, second, third]);
    });
  });

  describe("summarize()", () => {
    it("returns all-zero token and tool counts when no records have been added", () => {
      const nowSpy = jest.spyOn(Date, "now");
      nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1005);

      const collector = new TelemetryCollector("run-1");
      const summary = collector.summarize();

      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalOutputTokens).toBe(0);
      expect(summary.totalToolCalls).toBe(0);
      expect(summary.totalToolFailures).toBe(0);
      expect(summary.records).toEqual([]);
    });

    it("sums inputTokens correctly across multiple records", () => {
      const collector = new TelemetryCollector("run-1");

      collector.record(makeRecord({ inputTokens: 10 }));
      collector.record(makeRecord({ inputTokens: 25 }));
      collector.record(makeRecord({ inputTokens: 5 }));

      expect(collector.summarize().totalInputTokens).toBe(40);
    });

    it("sums outputTokens correctly across multiple records", () => {
      const collector = new TelemetryCollector("run-1");

      collector.record(makeRecord({ outputTokens: 7 }));
      collector.record(makeRecord({ outputTokens: 13 }));
      collector.record(makeRecord({ outputTokens: 20 }));

      expect(collector.summarize().totalOutputTokens).toBe(40);
    });

    it("sums totalToolCalls as the sum of toolEvents.length across all records", () => {
      const collector = new TelemetryCollector("run-1");

      collector.record(
        makeRecord({
          toolEvents: [
            { toolName: "tool-a", success: true },
            { toolName: "tool-b", success: false },
          ],
        }),
      );
      collector.record(
        makeRecord({
          toolEvents: [{ toolName: "tool-c", success: true }],
        }),
      );
      collector.record(makeRecord({ toolEvents: [] }));

      expect(collector.summarize().totalToolCalls).toBe(3);
    });

    it("counts totalToolFailures as only the toolEvents where success === false, not total tool events", () => {
      const collector = new TelemetryCollector("run-1");

      collector.record(
        makeRecord({
          toolEvents: [
            { toolName: "tool-a", success: false },
            { toolName: "tool-b", success: true },
          ],
        }),
      );
      collector.record(
        makeRecord({
          toolEvents: [
            { toolName: "tool-c", success: false },
            { toolName: "tool-d", success: false },
          ],
        }),
      );

      expect(collector.summarize().totalToolFailures).toBe(3);
    });

    it("does not count success === true tool events as failures", () => {
      const collector = new TelemetryCollector("run-1");

      collector.record(
        makeRecord({
          toolEvents: [
            { toolName: "tool-a", success: true },
            { toolName: "tool-b", success: true },
          ],
        }),
      );

      expect(collector.summarize().totalToolFailures).toBe(0);
    });

    it("returns a durationMs that is a non-negative number", () => {
      const nowSpy = jest.spyOn(Date, "now");
      nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1125);

      const collector = new TelemetryCollector("run-1");
      const summary = collector.summarize();

      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
      expect(summary.durationMs).toBe(125);
    });

    it("includes all records in summary.records in insertion order", () => {
      const collector = new TelemetryCollector("run-1");
      const first = makeRecord({ step: 1, node: "manager" });
      const second = makeRecord({ step: 2, node: "planner" });

      collector.record(first);
      collector.record(second);

      expect(collector.summarize().records).toEqual([first, second]);
    });

    it("returns runId matching the value passed to the constructor", () => {
      const collector = new TelemetryCollector("custom-run-id");

      expect(collector.summarize().runId).toBe("custom-run-id");
    });

    it("handles records where toolEvents is an empty array without errors", () => {
      const collector = new TelemetryCollector("run-1");

      collector.record(makeRecord({ toolEvents: [] }));
      collector.record(makeRecord({ toolEvents: [] }));

      const summary = collector.summarize();

      expect(summary.totalToolCalls).toBe(0);
      expect(summary.totalToolFailures).toBe(0);
      expect(summary.records).toHaveLength(2);
    });

    it("includes records with modelTier === undefined without filtering them out", () => {
      const collector = new TelemetryCollector("run-1");
      const record = makeRecord({ modelTier: undefined });

      collector.record(record);

      expect(collector.summarize().records).toContainEqual(record);
      expect(collector.summarize().records[0].modelTier).toBeUndefined();
    });
  });
});
