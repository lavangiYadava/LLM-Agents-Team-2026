import {
  computeRateMetrics,
  RateMetrics,
} from "@openswe/shared/open-swe/budget-rate";
import { collectors } from "./telemetry-wrapper.js";

export function getRateMetricsForThread(
  threadId: string | undefined,
  remainingTokens: number,
  opts?: {
    windowSize?: number;
    nodeFilter?: string | string[] | ((node: string) => boolean);
  },
): RateMetrics {
  if (!threadId || !collectors.has(threadId)) {
    return computeRateMetrics({
      records: [],
      remainingTokens,
      windowSize: opts?.windowSize,
      nodeFilter: opts?.nodeFilter,
    });
  }

  const records = collectors.get(threadId)!.summarize().records;
  return computeRateMetrics({
    records,
    remainingTokens,
    windowSize: opts?.windowSize,
    nodeFilter: opts?.nodeFilter,
  });
}
