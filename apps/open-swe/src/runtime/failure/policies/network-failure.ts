import type { RunnableConfig } from "@langchain/core/runnables";
import { NetworkFailureError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const MAX_NETWORK_RETRIES = 3;

const logger = createLogger(LogLevel.INFO, "policy:network-failure");

export async function handleNetworkFailure(
  error: NetworkFailureError,
  state: GraphState,
  config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  const allowedRetries = Math.max(
    1,
    Math.floor(budget.remainingTokenFraction() * MAX_NETWORK_RETRIES),
  );

  if (error.attemptCount > allowedRetries) {
    await checkpointState(state, config);
    logger.info("Network failure retry budget exhausted.", {
      attemptCount: error.attemptCount,
      allowedRetries,
      originNode: error.originNode,
    });
    return {
      resolved: false,
      terminationKind: "hard",
      stateCheckpointed: true,
      qualityFlagEmitted: false,
      message: "Network failure: retry budget exhausted",
    };
  }

  logger.info("Network failure retry allowed.", {
    attemptCount: error.attemptCount,
    allowedRetries,
    originNode: error.originNode,
  });

  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: false,
    message: `Network retry ${error.attemptCount} of ${allowedRetries} allowed`,
  };
}
