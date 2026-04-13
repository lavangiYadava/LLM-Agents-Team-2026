import type { RunnableConfig } from "@langchain/core/runnables";
import {
  ModelUnavailableError,
  RecoveryOutcome,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";
import { getModelManager } from "../../../utils/llms/model-manager.js";

const modelManager = getModelManager() as unknown as {
  requestTierUpgrade?: (node: string, reason: string) => void;
};

const logger = createLogger(LogLevel.INFO, "policy:model-unavailable");

export async function handleModelUnavailable(
  error: ModelUnavailableError,
  state: GraphState,
  config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  modelManager.requestTierUpgrade?.(error.originNode, "model-unavailable");

  if (!budget.canAffordUpgrade() || budget.isExhausted()) {
    await checkpointState(state, config);
    logger.info("All model tiers unavailable.", {
      originNode: error.originNode,
      modelId: error.modelId,
      canAffordUpgrade: budget.canAffordUpgrade(),
      isExhausted: budget.isExhausted(),
    });
    return {
      resolved: false,
      terminationKind: "hard",
      stateCheckpointed: true,
      qualityFlagEmitted: false,
      message: `All model tiers unavailable: ${error.modelId}`,
    };
  }

  logger.info("Falling through from unavailable model.", {
    originNode: error.originNode,
    modelId: error.modelId,
  });
  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: false,
    message: `Falling through from unavailable model ${error.modelId}`,
  };
}
