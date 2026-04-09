import type { RunnableConfig } from "@langchain/core/runnables";
import {
  QualityDegradationError,
  RecoveryOutcome,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";
import { getModelManager } from "../../../utils/llms/model-manager.js";

const modelManager = getModelManager() as unknown as {
  requestTierUpgrade?: (node: string, reason: string) => void;
};

const logger = createLogger(LogLevel.INFO, "policy:quality-degradation");

export async function handleQualityDegradation(
  error: QualityDegradationError,
  state: GraphState,
  _config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  if (budget.canAffordUpgrade()) {
    modelManager.requestTierUpgrade?.(error.originNode, "quality-degradation");
    logger.info("Tier upgraded for quality retry.", {
      originNode: error.originNode,
      validationDetails: error.validationDetails,
    });
    return {
      resolved: true,
      terminationKind: "graceful",
      stateCheckpointed: false,
      qualityFlagEmitted: false,
      message: "Tier upgraded for quality retry",
    };
  }

  state.qualityFlag = {
    reason: error.validationDetails,
    emittedAt: new Date().toISOString(),
  };

  logger.info("Quality degradation accepted with warning flag.", {
    originNode: error.originNode,
    validationDetails: error.validationDetails,
  });

  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: true,
    message: "Quality degradation accepted with warning flag",
  };
}
