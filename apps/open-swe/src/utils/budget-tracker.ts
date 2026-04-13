import { AIMessageChunk } from "@langchain/core/messages";
import {
  BudgetState,
  BudgetStatus,
  DEFAULT_BUDGET_CONFIG,
} from "@openswe/shared/open-swe/budget-types";
import {
  checkBudget,
  createDefaultBudgetState,
  updateBudgetUsage,
} from "@openswe/shared/open-swe/budget-enforcement";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "./logger.js";

const logger = createLogger(LogLevel.INFO, "BudgetTracker");

export function initializeBudgetState(config: GraphConfig): BudgetState {
  const maxBudgetTokens =
    config.configurable?.maxBudgetTokens ?? DEFAULT_BUDGET_CONFIG.maxBudgetTokens;
  const maxBudgetToolCalls =
    config.configurable?.maxBudgetToolCalls ??
    DEFAULT_BUDGET_CONFIG.maxBudgetToolCalls;
  const maxBudgetActions =
    config.configurable?.maxBudgetActions ?? DEFAULT_BUDGET_CONFIG.maxBudgetActions;

  const state = createDefaultBudgetState({
    maxBudgetTokens,
    maxBudgetToolCalls,
    maxBudgetActions,
  });

  logger.info("Budget initialized", {
    maxBudgetTokens,
    maxBudgetToolCalls,
    maxBudgetActions,
  });

  return state;
}

export function getOrInitBudgetState(
  currentState: BudgetState | undefined,
  config: GraphConfig,
): BudgetState {
  if (currentState) return currentState;
  return initializeBudgetState(config);
}

export function recordTokenUsage(
  currentState: BudgetState,
  response: AIMessageChunk,
  nodeName: string,
): BudgetState {
  const inputTokens = response.usage_metadata?.input_tokens ?? 0;
  const outputTokens = response.usage_metadata?.output_tokens ?? 0;
  const totalNewTokens = inputTokens + outputTokens;

  const updated = updateBudgetUsage(currentState, {
    totalTokensUsed: totalNewTokens,
  });

  logger.info("Token usage recorded", {
    nodeName,
    inputTokens,
    outputTokens,
    totalNewTokens,
    totalTokensUsed: updated.usage.totalTokensUsed,
    status: updated.status,
  });

  return { ...updated, lastUpdatedNode: nodeName };
}

export function recordToolCalls(
  currentState: BudgetState,
  toolCallCount: number,
  nodeName: string,
): BudgetState {
  const updated = updateBudgetUsage(currentState, {
    totalToolCallsUsed: toolCallCount,
  });

  logger.info("Tool calls recorded", {
    nodeName,
    toolCallCount,
    totalToolCallsUsed: updated.usage.totalToolCallsUsed,
    status: updated.status,
  });

  return { ...updated, lastUpdatedNode: nodeName };
}

export function recordAction(
  currentState: BudgetState,
  nodeName: string,
): BudgetState {
  const updated = updateBudgetUsage(currentState, {
    totalActionsUsed: 1,
  });

  return { ...updated, lastUpdatedNode: nodeName };
}

export function shouldTerminate(budgetState: BudgetState): {
  terminate: boolean;
  reason: string;
  mode: "hard" | "graceful";
} {
  const result = checkBudget(budgetState);

  if (result.status === BudgetStatus.EXHAUSTED) {
    logger.warn("Budget EXHAUSTED — hard termination triggered", {
      message: result.message,
    });
    return {
      terminate: true,
      reason: result.message,
      mode: "hard",
    };
  }

  return {
    terminate: false,
    reason: "",
    mode: "graceful",
  };
}

export function shouldDegrade(budgetState: BudgetState): boolean {
  const result = checkBudget(budgetState);
  return result.status === BudgetStatus.DEGRADED;
}
