import { describe, expect, it } from "@jest/globals";
import {
  computeRateMetrics,
  formatRateSection,
  RateMetrics,
} from "../open-swe/budget-rate.js";
import type { NodeRecord } from "../telemetry/types.js";

function makeRecord(overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    runId: "test-run",
    node: "programmer",
    step: 0,
    wallClockMs: 1000,
    inputTokens: 1000,
    outputTokens: 500,
    toolEvents: [],
    outputSnapshot: "",
    modelId: "claude-sonnet-4-6",
    modelTier: undefined,
    ...overrides,
  };
}

describe("computeRateMetrics", () => {
  describe("empty / edge inputs", () => {
    it("returns hasData=false when records is empty", () => {
      const result = computeRateMetrics({
        records: [],
        remainingTokens: 1_000_000,
      });

      expect(result.hasData).toBe(false);
      expect(result.windowSize).toBe(0);
      expect(result.avgTokensPerStep).toBe(0);
      expect(result.estimatedStepsRemaining).toBeNull();
      expect(result.trend).toBe("insufficient_data");
    });

    it("uses all records when window is larger than records.length", () => {
      const records = [
        makeRecord({ inputTokens: 100, outputTokens: 100 }),
        makeRecord({ inputTokens: 200, outputTokens: 100 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 1000,
        windowSize: 10,
      });

      expect(result.windowSize).toBe(2);
      expect(result.avgTokensPerStep).toBe(250);
    });

    it("returns estimatedStepsRemaining=null when avgTokensPerStep is 0", () => {
      const records = [
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 1_000_000,
      });

      expect(result.avgTokensPerStep).toBe(0);
      expect(result.estimatedStepsRemaining).toBeNull();
    });

    it("returns estimatedStepsRemaining=0 when remainingTokens is 0", () => {
      const records = [makeRecord({ inputTokens: 1000, outputTokens: 500 })];

      const result = computeRateMetrics({
        records,
        remainingTokens: 0,
      });

      expect(result.estimatedStepsRemaining).toBe(0);
    });

    it("returns estimatedStepsRemaining=0 when remainingTokens is negative", () => {
      const records = [makeRecord({ inputTokens: 1000, outputTokens: 500 })];

      const result = computeRateMetrics({
        records,
        remainingTokens: -100,
      });

      expect(result.estimatedStepsRemaining).toBe(0);
    });

    it("clamps windowSize <= 0 to 1", () => {
      const records = [
        makeRecord({ inputTokens: 100, outputTokens: 100 }),
        makeRecord({ inputTokens: 200, outputTokens: 200 }),
        makeRecord({ inputTokens: 300, outputTokens: 300 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 10_000,
        windowSize: 0,
      });

      expect(result.windowSize).toBe(1);
      expect(result.avgTokensPerStep).toBe(600);
    });

    it("handles NaN windowSize by clamping to 1", () => {
      const records = [makeRecord({ inputTokens: 100, outputTokens: 100 })];

      const result = computeRateMetrics({
        records,
        remainingTokens: 1000,
        windowSize: Number.NaN,
      });

      expect(result.windowSize).toBe(1);
    });
  });

  describe("averages", () => {
    it("computes avgTokensPerStep as rounded mean of input+output", () => {
      const records = [
        makeRecord({ inputTokens: 1000, outputTokens: 500 }),
        makeRecord({ inputTokens: 2000, outputTokens: 1000 }),
        makeRecord({ inputTokens: 3000, outputTokens: 1500 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.avgTokensPerStep).toBe(3000);
    });

    it("computes avgToolCallsPerStep from toolEvents.length with 1 decimal", () => {
      const records = [
        makeRecord({
          toolEvents: [
            { toolName: "bash", success: true },
            { toolName: "grep", success: true },
          ],
        }),
        makeRecord({ toolEvents: [{ toolName: "bash", success: true }] }),
        makeRecord({ toolEvents: [] }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.avgToolCallsPerStep).toBe(1);
    });

    it("rounds wall-clock averages", () => {
      const records = [
        makeRecord({ wallClockMs: 1000 }),
        makeRecord({ wallClockMs: 2000 }),
        makeRecord({ wallClockMs: 3000 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.avgWallClockMsPerStep).toBe(2000);
    });

    it("uses only the last N records when records.length > windowSize", () => {
      const records = [
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 1000, outputTokens: 500 }),
        makeRecord({ inputTokens: 1000, outputTokens: 500 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
        windowSize: 2,
      });

      expect(result.windowSize).toBe(2);
      expect(result.avgTokensPerStep).toBe(1500);
    });
  });

  describe("nodeFilter", () => {
    it("filters to requested node before windowing (string)", () => {
      const records = [
        makeRecord({ node: "planner" as NodeRecord["node"] }),
        makeRecord({
          node: "programmer" as NodeRecord["node"],
          inputTokens: 2000,
          outputTokens: 1000,
        }),
        makeRecord({ node: "planner" as NodeRecord["node"] }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
        nodeFilter: "programmer",
      });

      expect(result.windowSize).toBe(1);
      expect(result.avgTokensPerStep).toBe(3000);
    });

    it("filters by array of node names", () => {
      const records = [
        makeRecord({
          node: "generate-action" as NodeRecord["node"],
          inputTokens: 1000,
          outputTokens: 500,
        }),
        makeRecord({
          node: "take-action" as NodeRecord["node"],
          inputTokens: 100,
          outputTokens: 50,
        }),
        makeRecord({
          node: "diagnose-error" as NodeRecord["node"],
          inputTokens: 2000,
          outputTokens: 1000,
        }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
        nodeFilter: ["generate-action", "diagnose-error"],
      });

      expect(result.windowSize).toBe(2);
      expect(result.avgTokensPerStep).toBe(2250);
    });

    it("filters by predicate function", () => {
      const records = [
        makeRecord({
          node: "planner" as NodeRecord["node"],
          inputTokens: 100,
        }),
        makeRecord({
          node: "programmer" as NodeRecord["node"],
          inputTokens: 1000,
        }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
        nodeFilter: (node: string) => node === "programmer",
      });

      expect(result.windowSize).toBe(1);
    });

    it("returns no-data shape when filter yields empty window", () => {
      const records = [
        makeRecord({ node: "planner" as NodeRecord["node"] }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
        nodeFilter: "reviewer",
      });

      expect(result.hasData).toBe(false);
    });
  });

  describe("trend", () => {
    it("returns insufficient_data when window < 4", () => {
      const records = [
        makeRecord({ inputTokens: 100, outputTokens: 100 }),
        makeRecord({ inputTokens: 200, outputTokens: 200 }),
        makeRecord({ inputTokens: 300, outputTokens: 300 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.trend).toBe("insufficient_data");
    });

    it("returns stable when delta within ±5%", () => {
      const records = [
        makeRecord({ inputTokens: 1000, outputTokens: 0 }),
        makeRecord({ inputTokens: 1010, outputTokens: 0 }),
        makeRecord({ inputTokens: 1020, outputTokens: 0 }),
        makeRecord({ inputTokens: 1030, outputTokens: 0 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.trend).toBe("stable");
    });

    it("returns increasing when second half >5% higher", () => {
      const records = [
        makeRecord({ inputTokens: 1000, outputTokens: 0 }),
        makeRecord({ inputTokens: 1000, outputTokens: 0 }),
        makeRecord({ inputTokens: 1500, outputTokens: 0 }),
        makeRecord({ inputTokens: 1500, outputTokens: 0 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.trend).toBe("increasing");
      expect(result.trendDeltaPct).toBe(50);
    });

    it("returns decreasing when second half >5% lower", () => {
      const records = [
        makeRecord({ inputTokens: 2000, outputTokens: 0 }),
        makeRecord({ inputTokens: 2000, outputTokens: 0 }),
        makeRecord({ inputTokens: 1000, outputTokens: 0 }),
        makeRecord({ inputTokens: 1000, outputTokens: 0 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.trend).toBe("decreasing");
      expect(result.trendDeltaPct).toBe(-50);
    });

    it("handles first-half mean of 0 with positive second half without NaN", () => {
      const records = [
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 1000, outputTokens: 0 }),
        makeRecord({ inputTokens: 1000, outputTokens: 0 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.trend).toBe("increasing");
      expect(result.trendDeltaPct).toBe(100);
      expect(Number.isNaN(result.trendDeltaPct)).toBe(false);
    });

    it("reports stable when both halves are 0", () => {
      const records = [
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
        makeRecord({ inputTokens: 0, outputTokens: 0 }),
      ];

      const result = computeRateMetrics({
        records,
        remainingTokens: 100_000,
      });

      expect(result.trend).toBe("stable");
      expect(result.trendDeltaPct).toBe(0);
    });
  });

  describe("estimatedStepsRemaining", () => {
    it("equals floor(remainingTokens / avgTokensPerStep) in normal case", () => {
      const records = [makeRecord({ inputTokens: 1000, outputTokens: 500 })];

      const result = computeRateMetrics({
        records,
        remainingTokens: 10_000,
      });

      // avg = 1500, remaining = 10000 -> floor(10000/1500) = 6
      expect(result.avgTokensPerStep).toBe(1500);
      expect(result.estimatedStepsRemaining).toBe(6);
    });
  });
});

describe("formatRateSection", () => {
  it("renders cold-start line when hasData is false", () => {
    const metrics: RateMetrics = {
      windowSize: 0,
      windowRequested: 5,
      avgTokensPerStep: 0,
      avgToolCallsPerStep: 0,
      avgWallClockMsPerStep: 0,
      estimatedStepsRemaining: null,
      trend: "insufficient_data",
      trendDeltaPct: 0,
      hasData: false,
    };

    const output = formatRateSection(metrics);

    expect(output).toContain("Runtime Rate (last 5 steps):");
    expect(output).toContain("no completed steps yet");
  });

  it("renders all bullet lines when hasData is true", () => {
    const metrics: RateMetrics = {
      windowSize: 5,
      windowRequested: 5,
      avgTokensPerStep: 4823,
      avgToolCallsPerStep: 1.4,
      avgWallClockMsPerStep: 3120,
      estimatedStepsRemaining: 82,
      trend: "increasing",
      trendDeltaPct: 18,
      hasData: true,
    };

    const output = formatRateSection(metrics);

    expect(output).toContain("Runtime Rate (last 5 steps):");
    expect(output).toContain("Avg tokens/step: 4823");
    expect(output).toContain("Avg tool calls/step: 1.4");
    expect(output).toContain("Avg wall-clock/step: 3.1s");
    expect(output).toContain("~82");
    expect(output).toContain("increasing");
    expect(output).toContain("+18%");
  });

  it("renders insufficient-data marker for trend when appropriate", () => {
    const metrics: RateMetrics = {
      windowSize: 2,
      windowRequested: 5,
      avgTokensPerStep: 1500,
      avgToolCallsPerStep: 1.0,
      avgWallClockMsPerStep: 500,
      estimatedStepsRemaining: 10,
      trend: "insufficient_data",
      trendDeltaPct: 0,
      hasData: true,
    };

    const output = formatRateSection(metrics);

    expect(output).toContain("insufficient data");
  });

  it("renders unknown steps-remaining when avgTokensPerStep is 0", () => {
    const metrics: RateMetrics = {
      windowSize: 2,
      windowRequested: 5,
      avgTokensPerStep: 0,
      avgToolCallsPerStep: 0,
      avgWallClockMsPerStep: 100,
      estimatedStepsRemaining: null,
      trend: "insufficient_data",
      trendDeltaPct: 0,
      hasData: true,
    };

    const output = formatRateSection(metrics);

    expect(output).toContain("unknown");
  });

  it("renders ms for sub-second wall-clock", () => {
    const metrics: RateMetrics = {
      windowSize: 1,
      windowRequested: 5,
      avgTokensPerStep: 100,
      avgToolCallsPerStep: 0,
      avgWallClockMsPerStep: 250,
      estimatedStepsRemaining: 10,
      trend: "insufficient_data",
      trendDeltaPct: 0,
      hasData: true,
    };

    expect(formatRateSection(metrics)).toContain("250ms");
  });
});
