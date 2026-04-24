import type { NodeRecord } from "../telemetry/types.js";
import type { BudgetState } from "./budget-types.js";

export interface BurnRate {
  elapsedMs: number;
  tokensPerMinute: number;
  toolCallsPerMinute: number;
  actionsPerMinute: number;
}

export function calculateBurnRate(state: BudgetState): BurnRate {
  const startTime = state.startTime ?? Date.now();
  const elapsedMs = Math.max(1, Date.now() - startTime);
  const elapsedMinutes = elapsedMs / 60000;
  const tokens = state.tokenCount ?? state.usage.totalTokensUsed;
  const toolCalls = state.toolCallCount ?? state.usage.totalToolCallsUsed;
  const actions = state.actionCount ?? state.usage.totalActionsUsed;
  return {
    elapsedMs,
    tokensPerMinute: tokens / elapsedMinutes,
    toolCallsPerMinute: toolCalls / elapsedMinutes,
    actionsPerMinute: actions / elapsedMinutes,
  };
}

export interface RateMetrics {
  windowSize: number;
  windowRequested: number;
  avgTokensPerStep: number;
  avgToolCallsPerStep: number;
  avgWallClockMsPerStep: number;
  estimatedStepsRemaining: number | null;
  trend: "increasing" | "decreasing" | "stable" | "insufficient_data";
  trendDeltaPct: number;
  hasData: boolean;
}

export interface ComputeRateInput {
  records: ReadonlyArray<
    Pick<
      NodeRecord,
      "inputTokens" | "outputTokens" | "toolEvents" | "wallClockMs" | "node"
    >
  >;
  remainingTokens: number;
  windowSize?: number;
  /**
   * Optional filter applied to `record.node` before windowing. Pass a single
   * node name, a list of node names, or a predicate. Node names recorded by
   * the `timed()` wrapper are the granular graph-node identifiers (e.g.
   * "generate-action", "take-action"), not the broad graph categories.
   */
  nodeFilter?: string | string[] | ((node: string) => boolean);
}

const DEFAULT_WINDOW_SIZE = 5;
const TREND_THRESHOLD = 0.05;
const TREND_MIN_WINDOW = 4;

function noDataMetrics(windowRequested: number): RateMetrics {
  return {
    windowSize: 0,
    windowRequested,
    avgTokensPerStep: 0,
    avgToolCallsPerStep: 0,
    avgWallClockMsPerStep: 0,
    estimatedStepsRemaining: null,
    trend: "insufficient_data",
    trendDeltaPct: 0,
    hasData: false,
  };
}

function round(n: number): number {
  return Math.round(n);
}

function roundOneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeRateMetrics(input: ComputeRateInput): RateMetrics {
  const requested = input.windowSize ?? DEFAULT_WINDOW_SIZE;
  const windowRequested =
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;

  const clampedSize = Math.max(1, windowRequested);

  const filter = input.nodeFilter;
  const filtered = !filter
    ? input.records
    : typeof filter === "function"
      ? input.records.filter((r) => filter(r.node))
      : Array.isArray(filter)
        ? input.records.filter((r) => filter.includes(r.node))
        : input.records.filter((r) => r.node === filter);

  const window = filtered.slice(-clampedSize);

  if (window.length === 0) {
    return noDataMetrics(windowRequested);
  }

  const tokensPerStep = window.map(
    (r) => (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
  );
  const toolCallsPerStep = window.map((r) => r.toolEvents?.length ?? 0);
  const wallClockPerStep = window.map((r) => r.wallClockMs ?? 0);

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);

  const avgTokensPerStep = round(sum(tokensPerStep) / window.length);
  const avgToolCallsPerStep = roundOneDecimal(
    sum(toolCallsPerStep) / window.length,
  );
  const avgWallClockMsPerStep = round(sum(wallClockPerStep) / window.length);

  let estimatedStepsRemaining: number | null;
  if (avgTokensPerStep <= 0) {
    estimatedStepsRemaining = null;
  } else if (input.remainingTokens <= 0) {
    estimatedStepsRemaining = 0;
  } else {
    estimatedStepsRemaining = Math.floor(
      input.remainingTokens / avgTokensPerStep,
    );
  }

  let trend: RateMetrics["trend"] = "insufficient_data";
  let trendDeltaPct = 0;

  if (window.length >= TREND_MIN_WINDOW) {
    const splitAt = Math.floor(window.length / 2);
    const firstHalf = tokensPerStep.slice(0, splitAt);
    const secondHalf = tokensPerStep.slice(splitAt);
    const firstMean = sum(firstHalf) / firstHalf.length;
    const secondMean = sum(secondHalf) / secondHalf.length;

    if (firstMean === 0 && secondMean === 0) {
      trend = "stable";
      trendDeltaPct = 0;
    } else if (firstMean === 0 && secondMean > 0) {
      trend = "increasing";
      trendDeltaPct = 100;
    } else {
      const delta = (secondMean - firstMean) / firstMean;
      trendDeltaPct = Math.round(delta * 100);
      if (Math.abs(delta) < TREND_THRESHOLD) {
        trend = "stable";
      } else if (delta >= TREND_THRESHOLD) {
        trend = "increasing";
      } else {
        trend = "decreasing";
      }
    }
  }

  return {
    windowSize: window.length,
    windowRequested,
    avgTokensPerStep,
    avgToolCallsPerStep,
    avgWallClockMsPerStep,
    estimatedStepsRemaining,
    trend,
    trendDeltaPct,
    hasData: true,
  };
}

function formatWallClock(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${ms}ms`;
}

function formatTrendLine(metrics: RateMetrics): string {
  if (metrics.trend === "insufficient_data") {
    return `- Trend: insufficient data (need at least ${TREND_MIN_WINDOW} steps)`;
  }
  if (metrics.trend === "stable") {
    return `- Trend: stable (${metrics.trendDeltaPct >= 0 ? "+" : ""}${metrics.trendDeltaPct}% vs earlier in window)`;
  }
  if (metrics.trend === "increasing") {
    return `- Trend: increasing (+${metrics.trendDeltaPct}% vs earlier in window) — each turn is getting MORE expensive`;
  }
  return `- Trend: decreasing (${metrics.trendDeltaPct}% vs earlier in window) — each turn is getting less expensive`;
}

function formatStepsRemainingLine(metrics: RateMetrics): string {
  if (metrics.estimatedStepsRemaining === null) {
    return `- Estimated steps remaining at current rate: unknown (no token usage recorded)`;
  }
  return `- Estimated steps remaining at current rate: ~${metrics.estimatedStepsRemaining} (tokens-limited)`;
}

export function formatRateSection(metrics: RateMetrics): string {
  if (!metrics.hasData) {
    return `Runtime Rate (last ${metrics.windowRequested} steps):\n- Rate: no completed steps yet in this thread.`;
  }

  const header = `Runtime Rate (last ${metrics.windowSize} step${metrics.windowSize === 1 ? "" : "s"}):`;
  const lines = [
    header,
    `- Avg tokens/step: ${metrics.avgTokensPerStep} (input+output)`,
    `- Avg tool calls/step: ${metrics.avgToolCallsPerStep.toFixed(1)}`,
    `- Avg wall-clock/step: ${formatWallClock(metrics.avgWallClockMsPerStep)}`,
    formatStepsRemainingLine(metrics),
    formatTrendLine(metrics),
  ];
  return lines.join("\n");
}
