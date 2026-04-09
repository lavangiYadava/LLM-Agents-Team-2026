import type { RunnableConfig } from "@langchain/core/runnables";
import { RateLimitingError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const MAX_WALL_CLOCK_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const logger = createLogger(LogLevel.INFO, "policy:rate-limiting");

export async function handleRateLimiting(
  error: RateLimitingError,
  _state: GraphState,
  _config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  if (error.retryAfterMs > MAX_WALL_CLOCK_WAIT_MS || budget.isExhausted()) {
    budget.requestTierDowngrade(error.originNode);
    logger.info("Rate limit wait exceeds budget, downgrading tier.", {
      retryAfterMs: error.retryAfterMs,
      maxWallClockWaitMs: MAX_WALL_CLOCK_WAIT_MS,
      budgetExhausted: budget.isExhausted(),
      originNode: error.originNode,
    });
    return {
      resolved: true,
      terminationKind: "graceful",
      stateCheckpointed: false,
      qualityFlagEmitted: false,
      message: "Rate limit wait exceeds budget — downgrading tier",
    };
  }

  logger.info("Waiting for rate limit window.", {
    retryAfterMs: error.retryAfterMs,
    originNode: error.originNode,
  });
  await sleep(error.retryAfterMs);

  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: false,
    message: `Waited ${error.retryAfterMs}ms for rate limit — retrying`,
  };
}
