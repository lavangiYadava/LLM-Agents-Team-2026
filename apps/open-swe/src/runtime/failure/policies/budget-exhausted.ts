import type { RunnableConfig } from "@langchain/core/runnables";
import { BudgetExhaustedError, RecoveryOutcome } from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../../budget/index.js";
import { checkpointState } from "../checkpoint.js";
import { createLogger, LogLevel } from "../../../utils/logger.js";

const logger = createLogger(LogLevel.INFO, "policy:budget-exhausted");

export async function handleBudgetExhausted(
  error: BudgetExhaustedError,
  state: GraphState,
  config: RunnableConfig,
  budget: BudgetState,
): Promise<RecoveryOutcome> {
  await checkpointState(state, config);

  const remaining = budget.remaining();
  const degradationSignal = `[RUNTIME BUDGET SIGNAL] Budget nearly exhausted. Remaining: ~${remaining.tokens} tokens, ${remaining.toolCalls} tool calls. Prioritise completing the most critical outstanding plan steps. Produce a best-effort partial pull request rather than continuing full execution.`;

  state.degradationSignal = degradationSignal;

  logger.info("Budget exhausted: degradation signal set.", {
    dimension: error.dimension,
    remainingTokens: remaining.tokens,
    remainingToolCalls: remaining.toolCalls,
  });

  return {
    resolved: false,
    terminationKind: "graceful",
    stateCheckpointed: true,
    qualityFlagEmitted: false,
    message: `Budget exhausted (${error.dimension}) — best-effort output emitted`,
  };
}
