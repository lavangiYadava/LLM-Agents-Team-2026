import type { RunnableConfig } from "@langchain/core/runnables";
import { AuthFailureError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const logger = createLogger(LogLevel.WARN, "policy:auth-failure");

export async function handleAuthFailure(
  error: AuthFailureError,
  state: GraphState,
  config: RunnableConfig,
  _budget: BudgetState,
): Promise<RecoveryOutcome> {
  await checkpointState(state, config);

  logger.warn("Authentication failure requires manual intervention.", {
    originNode: error.originNode,
    attemptCount: error.attemptCount,
  });

  return {
    resolved: false,
    terminationKind: "hard",
    stateCheckpointed: true,
    qualityFlagEmitted: false,
    message:
      "Authentication failure (401/403) — manual credential intervention required",
  };
}
