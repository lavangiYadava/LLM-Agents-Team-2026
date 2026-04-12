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

export interface BudgetUsage {
  totalTokensUsed: number;
  totalToolCallsUsed: number;
  totalActionsUsed: number;
}

export interface BudgetState {
  config: BudgetConfig;
  usage: BudgetUsage;
  status: BudgetStatus;
  lastUpdatedNode: string;
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
  maxBudgetTokens: 2_000_000,
  maxBudgetToolCalls: 200,
  maxBudgetActions: 150,
};

export const DEFAULT_BUDGET_USAGE: BudgetUsage = {
  totalTokensUsed: 0,
  totalToolCallsUsed: 0,
  totalActionsUsed: 0,
};
