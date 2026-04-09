import type { RunnableConfig } from "@langchain/core/runnables";
import type { BudgetRemaining, BudgetState } from "./types.js";

function readBoolean(
  configurable: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = configurable[key];
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(
  configurable: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = configurable[key];
  return typeof value === "number" ? value : fallback;
}

export function getBudgetState(config: RunnableConfig): BudgetState {
  const configurable = (config.configurable ?? {}) as Record<string, unknown>;

  const remaining: BudgetRemaining = {
    tokens: readNumber(configurable, "budgetRemainingTokens", 0),
    toolCalls: readNumber(configurable, "budgetRemainingToolCalls", 0),
    actions: readNumber(configurable, "budgetRemainingActions", 0),
  };

  const exhausted = readBoolean(configurable, "budgetExhausted", false);
  const affordUpgrade = readBoolean(
    configurable,
    "budgetCanAffordUpgrade",
    false,
  );
  const continueRun = readBoolean(configurable, "budgetCanContinue", true);
  const tokenFraction = readNumber(
    configurable,
    "budgetRemainingTokenFraction",
    1.0,
  );

  return {
    isExhausted: () => exhausted,
    canAffordUpgrade: () => affordUpgrade,
    canContinue: () => continueRun,
    remainingTokenFraction: () => tokenFraction,
    remaining: () => remaining,
    requestTierDowngrade: (_nodeId: string) => {},
  };
}

export * from "./types.js";
