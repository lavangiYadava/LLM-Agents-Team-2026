import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolIntegrationError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const BACKUP_TOOL_MAP: Record<string, string> = {
  bash: "python_repl",
  browser: "search_api",
};

const logger = createLogger(LogLevel.INFO, "policy:tool-integration");

export async function handleToolIntegration(
  error: ToolIntegrationError,
  state: GraphState,
  config: RunnableConfig,
  _budget: BudgetState,
): Promise<RecoveryOutcome> {
  const fallback = BACKUP_TOOL_MAP[error.toolName] ?? null;

  if (fallback === null) {
    await checkpointState(state, config);
    logger.info("No backup tool available.", {
      toolName: error.toolName,
      originNode: error.originNode,
    });
    return {
      resolved: false,
      terminationKind: "hard",
      stateCheckpointed: true,
      qualityFlagEmitted: false,
      message: `No backup tool available for ${error.toolName}`,
    };
  }

  state.activeToolOverride = fallback;
  logger.info("Switched to fallback tool.", {
    toolName: error.toolName,
    fallback,
    originNode: error.originNode,
  });

  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: false,
    message: `Switched to fallback tool: ${fallback}`,
  };
}
