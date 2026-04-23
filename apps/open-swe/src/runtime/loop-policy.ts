import {
  GraphState,
  LoopMetadata,
  TerminationReason,
} from "@openswe/shared/open-swe/types";
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks";
import { BudgetState } from "@openswe/shared/open-swe/budget-types";

export interface LoopPolicyConfig {
  maxActions: number;
  maxReviewCount: number;
  maxWallClockMs: number;
  budgetWarningThreshold: number;
}

export type LoopDecision =
  | { action: "continue" }
  | { action: "degrade"; reason: TerminationReason }
  | { action: "terminate"; reason: TerminationReason; mode: "graceful" | "hard" };

function isTaskComplete(state: GraphState): boolean {
  if (!state.taskPlan) return false;
  try {
    const activePlanItems = getActivePlanItems(state.taskPlan);
    return activePlanItems.every((p) => p.completed);
  } catch {
    return false;
  }
}

export function evaluateLoopPolicy(
  state: GraphState,
  budget: BudgetState,
  config: LoopPolicyConfig,
): LoopDecision {
  if (isTaskComplete(state)) {
    return { action: "continue" };
  }

  const tokensUsed = budget.usage.totalTokensUsed;
  const maxTokens = budget.config.maxBudgetTokens;
  const toolCallsUsed = budget.usage.totalToolCallsUsed;
  const maxToolCalls = budget.config.maxBudgetToolCalls;

  if (tokensUsed >= maxTokens || toolCallsUsed >= maxToolCalls) {
    return { action: "terminate", reason: "budget_exhausted", mode: "hard" };
  }

  if (
    tokensUsed / maxTokens >= config.budgetWarningThreshold ||
    toolCallsUsed / maxToolCalls >= config.budgetWarningThreshold
  ) {
    return { action: "degrade", reason: "graceful_degradation" };
  }

  const meta: LoopMetadata | undefined = state.loop_metadata;

  if ((meta?.iteration_count ?? 0) >= config.maxActions) {
    return { action: "terminate", reason: "max_iterations", mode: "graceful" };
  }

  if ((meta?.reviewer_cycles ?? 0) >= config.maxReviewCount) {
    return {
      action: "terminate",
      reason: "max_reviewer_cycles",
      mode: "graceful",
    };
  }

  if (
    meta?.wall_clock_start_ms != null &&
    Date.now() - meta.wall_clock_start_ms >= config.maxWallClockMs
  ) {
    return { action: "terminate", reason: "timeout", mode: "graceful" };
  }

  return { action: "continue" };
}
