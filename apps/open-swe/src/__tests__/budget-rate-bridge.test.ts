import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { TelemetryCollector } from "@openswe/shared/telemetry";
import type { NodeRecord } from "@openswe/shared/telemetry";
import { collectors } from "../utils/telemetry-wrapper.js";
import { getRateMetricsForThread } from "../utils/budget-rate-bridge.js";

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

function seedCollector(threadId: string, records: NodeRecord[]): void {
  const collector = new TelemetryCollector(threadId);
  for (const r of records) {
    collector.record(r);
  }
  collectors.set(threadId, collector);
}

describe("getRateMetricsForThread", () => {
  beforeEach(() => {
    collectors.clear();
  });

  afterEach(() => {
    collectors.clear();
  });

  it("returns no-data shape when threadId is undefined", () => {
    const result = getRateMetricsForThread(undefined, 1_000_000);

    expect(result.hasData).toBe(false);
    expect(result.estimatedStepsRemaining).toBeNull();
  });

  it("returns no-data shape when no collector is registered for threadId", () => {
    const result = getRateMetricsForThread("unknown-thread", 1_000_000);

    expect(result.hasData).toBe(false);
  });

  it("reads records from the registered collector and computes metrics", () => {
    seedCollector("thread-x", [
      makeRecord({ inputTokens: 1000, outputTokens: 500 }),
      makeRecord({ inputTokens: 2000, outputTokens: 1000 }),
    ]);

    const result = getRateMetricsForThread("thread-x", 100_000, {
      windowSize: 5,
    });

    expect(result.hasData).toBe(true);
    expect(result.windowSize).toBe(2);
    // avg = (1500 + 3000) / 2 = 2250
    expect(result.avgTokensPerStep).toBe(2250);
  });

  it("passes through windowSize option", () => {
    seedCollector("thread-y", [
      makeRecord({ inputTokens: 0, outputTokens: 0 }),
      makeRecord({ inputTokens: 0, outputTokens: 0 }),
      makeRecord({ inputTokens: 1000, outputTokens: 500 }),
      makeRecord({ inputTokens: 1000, outputTokens: 500 }),
    ]);

    const result = getRateMetricsForThread("thread-y", 100_000, {
      windowSize: 2,
    });

    expect(result.windowSize).toBe(2);
    expect(result.avgTokensPerStep).toBe(1500);
  });

  it("passes through nodeFilter option", () => {
    seedCollector("thread-z", [
      makeRecord({
        node: "planner" as NodeRecord["node"],
        inputTokens: 100,
        outputTokens: 50,
      }),
      makeRecord({
        node: "programmer" as NodeRecord["node"],
        inputTokens: 2000,
        outputTokens: 1000,
      }),
    ]);

    const result = getRateMetricsForThread("thread-z", 100_000, {
      nodeFilter: "programmer",
    });

    expect(result.windowSize).toBe(1);
    expect(result.avgTokensPerStep).toBe(3000);
  });

  it("computes estimatedStepsRemaining from provided remainingTokens", () => {
    seedCollector("thread-q", [
      makeRecord({ inputTokens: 1000, outputTokens: 0 }),
    ]);

    const result = getRateMetricsForThread("thread-q", 10_000);

    expect(result.avgTokensPerStep).toBe(1000);
    expect(result.estimatedStepsRemaining).toBe(10);
  });
});
