import type { RunnableConfig } from "@langchain/core/runnables";
import { MalformedOutputError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const MAX_REFLEXION_RETRIES = 1;

const logger = createLogger(LogLevel.INFO, "policy:malformed-output");

export async function handleMalformedOutput(
  error: MalformedOutputError,
  state: GraphState,
  config: RunnableConfig,
  _budget: BudgetState,
): Promise<RecoveryOutcome> {
  if (error.attemptCount > MAX_REFLEXION_RETRIES) {
    await checkpointState(state, config);
    logger.info("Malformed output: Reflexion retry exhausted.", {
      attemptCount: error.attemptCount,
      maxRetries: MAX_REFLEXION_RETRIES,
    });
    return {
      resolved: false,
      terminationKind: "hard",
      stateCheckpointed: true,
      qualityFlagEmitted: false,
      message: "Malformed output: Reflexion retry exhausted",
    };
  }

  const excerpt = error.rawOutput.substring(0, 500);
  const reflexionContext = `[REFLEXION SIGNAL] Your previous output failed schema/parse validation. Here is the offending excerpt:\n\n${excerpt}\n\nCorrect the structure and resubmit. Ensure the output matches the expected JSON schema exactly.`;

  state.reflexionContext = reflexionContext;

  logger.info("Malformed output: Reflexion context set.", {
    attemptCount: error.attemptCount,
    excerptLength: excerpt.length,
  });

  return {
    resolved: true,
    terminationKind: "graceful",
    stateCheckpointed: false,
    qualityFlagEmitted: false,
    message: "Reflexion retry injected",
  };
}
