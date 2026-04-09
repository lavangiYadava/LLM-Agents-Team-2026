export interface BudgetRemaining {
  tokens: number;
  toolCalls: number;
  actions: number;
}

export interface BudgetState {
  isExhausted(): boolean;
  canAffordUpgrade(): boolean;
  canContinue(): boolean;
  remainingTokenFraction(): number;
  remaining(): BudgetRemaining;
  requestTierDowngrade(nodeId: string): void;
}
