import type { RunnableConfig } from "@langchain/core/runnables";
import { ContextOverflowError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";
import { getModelManager } from "../../../utils/llms/model-manager.js";

const modelManager = getModelManager() as unknown as {
  requestTierUpgrade?: (node: string, reason: string) => void;
};

const logger = createLogger(LogLevel.INFO, "policy:context-overflow");

export async function handleContextOverflow(
  error: ContextOverflowError,
  state: GraphState,
  config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  if (budget.canAffordUpgrade()) {
    modelManager.requestTierUpgrade?.(error.originNode, "context-overflow");
    logger.info("Upgrading to higher-context model.", {
      originNode: error.originNode,
    });
    return {
      resolved: true,
      terminationKind: "graceful",
      stateCheckpointed: false,
      qualityFlagEmitted: false,
      message: "Upgrading to higher-context model",
    };
  }

  await checkpointState(state, config);
  logger.info("Context overflow: no viable model tier within budget.", {
    originNode: error.originNode,
  });
  return {
    resolved: false,
    terminationKind: "hard",
    stateCheckpointed: true,
    qualityFlagEmitted: false,
    message: "Context overflow: no viable model tier within budget",
  };
}
