import {
  BudgetCheckResult,
  BudgetConfig,
  BudgetState,
  BudgetStatus,
  BudgetUsage,
  BUDGET_THRESHOLDS,
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_BUDGET_USAGE,
} from "./budget-types.js";
import { calculateBurnRate, formatRateSection, RateMetrics } from "./budget-rate.js";

function getUtilization(used: number, max: number): number {
  if (max <= 0) return 0;
  return used / max;
}

function getStatusFromUtilization(utilization: number): BudgetStatus {
  if (utilization >= 1.0) return BudgetStatus.EXHAUSTED;
  if (utilization >= BUDGET_THRESHOLDS.degradationThreshold)
    return BudgetStatus.DEGRADED;
  if (utilization >= BUDGET_THRESHOLDS.warningThreshold)
    return BudgetStatus.WARNING;
  return BudgetStatus.NORMAL;
}

function worstStatus(a: BudgetStatus, b: BudgetStatus): BudgetStatus {
  const priority: Record<BudgetStatus, number> = {
    [BudgetStatus.NORMAL]: 0,
    [BudgetStatus.WARNING]: 1,
    [BudgetStatus.DEGRADED]: 2,
    [BudgetStatus.EXHAUSTED]: 3,
  };
  return priority[a] >= priority[b] ? a : b;
}

export function calculateBudgetStatus(
  config: BudgetConfig,
  usage: BudgetUsage,
): BudgetStatus {
  const tokenStatus = getStatusFromUtilization(
    getUtilization(usage.totalTokensUsed, config.maxBudgetTokens),
  );
  const toolCallStatus = getStatusFromUtilization(
    getUtilization(usage.totalToolCallsUsed, config.maxBudgetToolCalls),
  );
  const actionStatus = getStatusFromUtilization(
    getUtilization(usage.totalActionsUsed, config.maxBudgetActions),
  );
  return worstStatus(tokenStatus, worstStatus(toolCallStatus, actionStatus));
}

export function checkBudget(state: BudgetState): BudgetCheckResult {
  const { config, usage } = state;

  const tokenUtilization = getUtilization(
    usage.totalTokensUsed,
    config.maxBudgetTokens,
  );
  const toolCallUtilization = getUtilization(
    usage.totalToolCallsUsed,
    config.maxBudgetToolCalls,
  );
  const actionUtilization = getUtilization(
    usage.totalActionsUsed,
    config.maxBudgetActions,
  );

  const status = calculateBudgetStatus(config, usage);
  const canContinue = status !== BudgetStatus.EXHAUSTED;

  let message: string;
  switch (status) {
    case BudgetStatus.EXHAUSTED:
      message = `Budget exhausted. Tokens: ${usage.totalTokensUsed}/${config.maxBudgetTokens}, Tool calls: ${usage.totalToolCallsUsed}/${config.maxBudgetToolCalls}, Actions: ${usage.totalActionsUsed}/${config.maxBudgetActions}.`;
      break;
    case BudgetStatus.DEGRADED:
      message = `Budget critically low (>90%). Entering graceful degradation. Tokens: ${usage.totalTokensUsed}/${config.maxBudgetTokens}, Tool calls: ${usage.totalToolCallsUsed}/${config.maxBudgetToolCalls}, Actions: ${usage.totalActionsUsed}/${config.maxBudgetActions}.`;
      break;
    case BudgetStatus.WARNING:
      message = `Budget warning (>80%). Tokens: ${usage.totalTokensUsed}/${config.maxBudgetTokens}, Tool calls: ${usage.totalToolCallsUsed}/${config.maxBudgetToolCalls}, Actions: ${usage.totalActionsUsed}/${config.maxBudgetActions}.`;
      break;
    default:
      message = `Budget normal. Tokens: ${usage.totalTokensUsed}/${config.maxBudgetTokens}, Tool calls: ${usage.totalToolCallsUsed}/${config.maxBudgetToolCalls}, Actions: ${usage.totalActionsUsed}/${config.maxBudgetActions}.`;
  }

  return {
    canContinue,
    status,
    tokenUtilization,
    toolCallUtilization,
    actionUtilization,
    message,
  };
}

export function updateBudgetUsage(
  state: BudgetState,
  delta: Partial<BudgetUsage>,
): BudgetState {
  const updatedUsage: BudgetUsage = {
    totalTokensUsed:
      state.usage.totalTokensUsed + (delta.totalTokensUsed ?? 0),
    totalToolCallsUsed:
      state.usage.totalToolCallsUsed + (delta.totalToolCallsUsed ?? 0),
    totalActionsUsed:
      state.usage.totalActionsUsed + (delta.totalActionsUsed ?? 0),
  };

  const updatedStatus = calculateBudgetStatus(state.config, updatedUsage);

  return {
    ...state,
    tokenCount: (state.tokenCount ?? state.usage.totalTokensUsed) + (delta.totalTokensUsed ?? 0),
    toolCallCount:
      (state.toolCallCount ?? state.usage.totalToolCallsUsed) +
      (delta.totalToolCallsUsed ?? 0),
    actionCount: (state.actionCount ?? state.usage.totalActionsUsed) + (delta.totalActionsUsed ?? 0),
    usage: updatedUsage,
    status: updatedStatus,
  };
}

export function formatBudgetPromptInjection(state: BudgetState): string {
  const { config, usage, status } = state;

  const tokenPct = Math.round(
    getUtilization(usage.totalTokensUsed, config.maxBudgetTokens) * 100,
  );
  const toolCallPct = Math.round(
    getUtilization(usage.totalToolCallsUsed, config.maxBudgetToolCalls) * 100,
  );
  const actionPct = Math.round(
    getUtilization(usage.totalActionsUsed, config.maxBudgetActions) * 100,
  );

  const remainingTokens = Math.max(
    0,
    config.maxBudgetTokens - usage.totalTokensUsed,
  );
  const remainingToolCalls = Math.max(
    0,
    config.maxBudgetToolCalls - usage.totalToolCallsUsed,
  );
  const remainingActions = Math.max(
    0,
    config.maxBudgetActions - usage.totalActionsUsed,
  );

  let urgencyNote = "";
  if (status === BudgetStatus.DEGRADED) {
    urgencyNote = `\n\nCRITICAL: Your budget is nearly exhausted. You MUST wrap up your work immediately. Prioritize completing the single most important remaining task and produce a best-effort output. Do NOT start new multi-step investigations. Prefer direct edits over exploratory searches.`;
  } else if (status === BudgetStatus.WARNING) {
    urgencyNote = `\n\nWARNING: Your budget is running low. Be strategic with remaining resources. Prefer concise, targeted actions over broad exploration. Consider completing the most critical tasks first.`;
  }

  return `<budget_awareness>
Runtime Budget Status: ${status}
- Tokens: ${usage.totalTokensUsed}/${config.maxBudgetTokens} used (${tokenPct}%) — ${remainingTokens} remaining
- Tool Calls: ${usage.totalToolCallsUsed}/${config.maxBudgetToolCalls} used (${toolCallPct}%) — ${remainingToolCalls} remaining
- Actions: ${usage.totalActionsUsed}/${config.maxBudgetActions} used (${actionPct}%) — ${remainingActions} remaining${urgencyNote}
</budget_awareness>`;
}

export function formatBudgetPromptInjectionWithRate(
  budgetState: BudgetState,
  config: BudgetConfig,
): string;
export function formatBudgetPromptInjectionWithRate(
  budgetState: BudgetState,
  rate: RateMetrics | null,
): string;
export function formatBudgetPromptInjectionWithRate(
  budgetState: BudgetState,
  configOrRate: BudgetConfig | RateMetrics | null,
): string {
  if (
    configOrRate !== null &&
    "maxBudgetTokens" in configOrRate &&
    "maxBudgetToolCalls" in configOrRate &&
    "maxBudgetActions" in configOrRate
  ) {
    const config = configOrRate;
    const usedTokens = budgetState.tokenCount ?? budgetState.usage.totalTokensUsed;
    const usedToolCalls =
      budgetState.toolCallCount ?? budgetState.usage.totalToolCallsUsed;
    const usedActions = budgetState.actionCount ?? budgetState.usage.totalActionsUsed;
    const status = calculateBudgetStatus(config, {
      totalTokensUsed: usedTokens,
      totalToolCallsUsed: usedToolCalls,
      totalActionsUsed: usedActions,
    });

    const tokenPct = Math.round(getUtilization(usedTokens, config.maxBudgetTokens) * 100);
    const toolCallPct = Math.round(
      getUtilization(usedToolCalls, config.maxBudgetToolCalls) * 100,
    );
    const actionPct = Math.round(
      getUtilization(usedActions, config.maxBudgetActions) * 100,
    );

    const remainingTokens = Math.max(0, config.maxBudgetTokens - usedTokens);
    const remainingToolCalls = Math.max(0, config.maxBudgetToolCalls - usedToolCalls);
    const remainingActions = Math.max(0, config.maxBudgetActions - usedActions);

    const burnRate = calculateBurnRate(budgetState);

    return `<budget_awareness>
Runtime Budget Status: ${status}
- Tokens: ${usedTokens}/${config.maxBudgetTokens} used (${tokenPct}%) - ${remainingTokens} remaining
- Tool Calls: ${usedToolCalls}/${config.maxBudgetToolCalls} used (${toolCallPct}%) - ${remainingToolCalls} remaining
- Actions: ${usedActions}/${config.maxBudgetActions} used (${actionPct}%) - ${remainingActions} remaining
- Burn rate: ${burnRate.tokensPerMinute.toFixed(1)} tokens/min, ${burnRate.toolCallsPerMinute.toFixed(2)} tool calls/min, ${burnRate.actionsPerMinute.toFixed(2)} actions/min
</budget_awareness>`;
  }

  const rate = configOrRate;
  if (rate === null) {
    return formatBudgetPromptInjection(budgetState);
  }

  const { config, usage, status } = budgetState;

  const tokenPct = Math.round(
    getUtilization(usage.totalTokensUsed, config.maxBudgetTokens) * 100,
  );
  const toolCallPct = Math.round(
    getUtilization(usage.totalToolCallsUsed, config.maxBudgetToolCalls) * 100,
  );
  const actionPct = Math.round(
    getUtilization(usage.totalActionsUsed, config.maxBudgetActions) * 100,
  );

  const remainingTokens = Math.max(
    0,
    config.maxBudgetTokens - usage.totalTokensUsed,
  );
  const remainingToolCalls = Math.max(
    0,
    config.maxBudgetToolCalls - usage.totalToolCallsUsed,
  );
  const remainingActions = Math.max(
    0,
    config.maxBudgetActions - usage.totalActionsUsed,
  );

  let urgencyNote = "";
  if (status === BudgetStatus.DEGRADED) {
    urgencyNote = `\n\nCRITICAL: Your budget is nearly exhausted. You MUST wrap up your work immediately. Prioritize completing the single most important remaining task and produce a best-effort output. Do NOT start new multi-step investigations. Prefer direct edits over exploratory searches.`;
  } else if (status === BudgetStatus.WARNING) {
    urgencyNote = `\n\nWARNING: Your budget is running low. Be strategic with remaining resources. Prefer concise, targeted actions over broad exploration. Consider completing the most critical tasks first.`;
  }

  const rateSection = formatRateSection(rate);

  return `<budget_awareness>
Runtime Budget Status: ${status}
- Tokens: ${usage.totalTokensUsed}/${config.maxBudgetTokens} used (${tokenPct}%) — ${remainingTokens} remaining
- Tool Calls: ${usage.totalToolCallsUsed}/${config.maxBudgetToolCalls} used (${toolCallPct}%) — ${remainingToolCalls} remaining
- Actions: ${usage.totalActionsUsed}/${config.maxBudgetActions} used (${actionPct}%) — ${remainingActions} remaining
${rateSection}${urgencyNote}
</budget_awareness>`;
}

export function createDefaultBudgetState(
  configOverrides?: Partial<BudgetConfig>,
): BudgetState {
  const config = { ...DEFAULT_BUDGET_CONFIG, ...configOverrides };
  return {
    tokenCount: 0,
    toolCallCount: 0,
    actionCount: 0,
    startTime: Date.now(),
    config,
    usage: { ...DEFAULT_BUDGET_USAGE },
    status: BudgetStatus.NORMAL,
    lastUpdatedNode: "",
    remaining: () => ({
      tokens: Math.max(0, config.maxBudgetTokens),
      toolCalls: Math.max(0, config.maxBudgetToolCalls),
      actions: Math.max(0, config.maxBudgetActions),
    }),
  };
}

export function budgetStateReducer(
  state: BudgetState | undefined,
  update: BudgetState,
): BudgetState {
  if (!state) {
    return update;
  }
  return update;
}
