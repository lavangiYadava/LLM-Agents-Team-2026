export enum BudgetStatus {
  NORMAL = "NORMAL",
  WARNING = "WARNING",
  DEGRADED = "DEGRADED",
  EXHAUSTED = "EXHAUSTED",
}

export interface BudgetConfig {
  maxBudgetTokens: number;
  maxBudgetToolCalls: number;
  maxBudgetActions: number;
}

export interface BudgetRemaining {
  tokens: number;
  toolCalls: number;
  actions: number;
}

export interface BudgetUsage {
  totalTokensUsed: number;
  totalToolCallsUsed: number;
  totalActionsUsed: number;
}

export interface BudgetState {
  tokenCount?: number;
  toolCallCount?: number;
  actionCount?: number;
  startTime?: number;
  config: BudgetConfig;
  usage: BudgetUsage;
  status: BudgetStatus;
  lastUpdatedNode: string;
  remaining?(): BudgetRemaining;
}

export interface BudgetCheckResult {
  canContinue: boolean;
  status: BudgetStatus;
  tokenUtilization: number;
  toolCallUtilization: number;
  actionUtilization: number;
  message: string;
}

export const BUDGET_THRESHOLDS = {
  warningThreshold: 0.8,
  degradationThreshold: 0.9,
} as const;

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  maxBudgetTokens: 500_000,
  maxBudgetToolCalls: 200,
  maxBudgetActions: 100,
};

export const DEFAULT_BUDGET_USAGE: BudgetUsage = {
  totalTokensUsed: 0,
  totalToolCallsUsed: 0,
  totalActionsUsed: 0,
};
