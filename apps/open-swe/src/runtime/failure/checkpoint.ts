import type { RunnableConfig } from "@langchain/core/runnables";
import type { GraphState } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "../../utils/logger.js";

export interface CheckpointRecord {
  checkpointedAt: string;
  nodeSnapshot: string;
  partialPlan: unknown;
  iterationCount: number;
  tokenUsage: unknown;
}

const logger = createLogger(LogLevel.INFO, "failure:checkpoint");

function readConfigurableCurrentNode(config: RunnableConfig): unknown {
  const configurable = config.configurable as
    | Record<string, unknown>
    | undefined;
  return configurable?.currentNode ?? configurable?.activeNode ?? null;
}

export async function checkpointState(
  state: GraphState,
  config: RunnableConfig,
): Promise<void> {
  const record: CheckpointRecord = {
    checkpointedAt: new Date().toISOString(),
    nodeSnapshot: JSON.stringify({
      currentNode: readConfigurableCurrentNode(config),
      branchName: state.branchName ?? null,
      sandboxSessionId: state.sandboxSessionId ?? null,
    }),
    partialPlan: state.taskPlan ?? null,
    iterationCount: state.reviewerCycleCount ?? state.reviewsCount ?? 0,
    tokenUsage: state.tokenData ?? null,
  };

  const configurable = config.configurable as
    | Record<string, unknown>
    | undefined;
  if (configurable) {
    configurable.failureCheckpoint = record;
  }

  logger.info("State checkpointed for failure handling.", record);
}
