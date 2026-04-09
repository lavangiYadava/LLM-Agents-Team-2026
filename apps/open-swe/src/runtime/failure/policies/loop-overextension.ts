import type { RunnableConfig } from "@langchain/core/runnables";
import {
  LoopOverextensionError,
  RecoveryOutcome,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const logger = createLogger(LogLevel.INFO, "policy:loop-overextension");

export async function handleLoopOverextension(
  error: LoopOverextensionError,
  state: GraphState,
  config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  if (budget.canContinue()) {
    logger.info("Loop overextension: budget allows one more pass.", {
      originNode: error.originNode,
      loopCount: error.loopCount,
    });
    return {
      resolved: true,
      terminationKind: "graceful",
      stateCheckpointed: false,
      qualityFlagEmitted: false,
      message: `Loop at ${error.loopCount} iterations — budget allows one more pass`,
    };
  }

  await checkpointState(state, config);
  logger.info("Loop overextension: terminating gracefully.", {
    originNode: error.originNode,
    loopCount: error.loopCount,
  });
  return {
    resolved: false,
    terminationKind: "graceful",
    stateCheckpointed: true,
    qualityFlagEmitted: false,
    message: `Loop overextension at ${error.loopCount} iterations — terminating gracefully`,
  };
}
