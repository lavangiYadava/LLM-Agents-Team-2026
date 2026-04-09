import type { RunnableConfig } from "@langchain/core/runnables";
import { ApiTimeoutError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const logger = createLogger(LogLevel.INFO, "policy:api-timeout");

export async function handleApiTimeout(
  error: ApiTimeoutError,
  state: GraphState,
  config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  if (error.attemptCount > MAX_RETRIES || budget.isExhausted()) {
    await checkpointState(state, config);
    logger.info("API timeout: retries exhausted or budget exhausted.", {
      attemptCount: error.attemptCount,
      maxRetries: MAX_RETRIES,
      budgetExhausted: budget.isExhausted(),
    });
    return {
      resolved: false,
      terminationKind: "hard",
      stateCheckpointed: true,
      qualityFlagEmitted: false,
      message: "API timeout: retries exhausted",
    };
  }

  const delayMs = BASE_DELAY_MS * 2 ** (error.attemptCount - 1);
  logger.info("Sleeping before retry.", {
    attemptCount: error.attemptCount,
    delayMs,
  });
  await sleep(delayMs);

  if (error.attemptCount >= 2) {
    budget.requestTierDowngrade(error.originNode);
    logger.info("Requested tier downgrade.", {
      originNode: error.originNode,
      attemptCount: error.attemptCount,
    });
  }

  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: false,
    message: `Retrying (attempt ${error.attemptCount + 1})`,
  };
}
