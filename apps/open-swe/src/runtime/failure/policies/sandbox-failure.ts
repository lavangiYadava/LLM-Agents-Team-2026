import type { RunnableConfig } from "@langchain/core/runnables";
import { SandboxFailureError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphConfig, GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";
import { getSandboxWithErrorHandling } from "../../../utils/sandbox.js";

const logger = createLogger(LogLevel.INFO, "policy:sandbox-failure");

async function restartSandbox(
  state: GraphState,
  config: RunnableConfig,
): Promise<boolean> {
  try {
    await getSandboxWithErrorHandling(
      state.sandboxSessionId || undefined,
      state.targetRepository,
      state.branchName,
      config as GraphConfig,
    );
    return true;
  } catch {
    return false;
  }
}

export async function handleSandboxFailure(
  error: SandboxFailureError,
  state: GraphState,
  config: RunnableConfig,
  _budget: BudgetState,
): Promise<RecoveryOutcome> {
  const restarted = await restartSandbox(state, config);

  if (restarted) {
    logger.info("Sandbox restarted successfully.", {
      originNode: error.originNode,
      exitCode: error.exitCode,
    });
    return {
      resolved: true,
      terminationKind: "graceful",
      stateCheckpointed: false,
      qualityFlagEmitted: false,
      message: "Sandbox restarted successfully",
    };
  }

  state.unsolvable = true;
  await checkpointState(state, config);

  logger.info("Sandbox unrecoverable, marked unsolvable.", {
    originNode: error.originNode,
    exitCode: error.exitCode,
  });

  return {
    resolved: false,
    terminationKind: "hard",
    stateCheckpointed: true,
    qualityFlagEmitted: false,
    message: `Sandbox unrecoverable (exit ${error.exitCode}) — marked unsolvable`,
  };
}
