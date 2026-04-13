export enum FailureType {
  API_TIMEOUT = "API_TIMEOUT",
  BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED",
  TOOL_INTEGRATION = "TOOL_INTEGRATION",
  QUALITY_DEGRADATION = "QUALITY_DEGRADATION",
  CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW",
  LOOP_OVEREXTENSION = "LOOP_OVEREXTENSION",
  MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE",
  RATE_LIMITING = "RATE_LIMITING",
  SANDBOX_FAILURE = "SANDBOX_FAILURE",
  MALFORMED_OUTPUT = "MALFORMED_OUTPUT",
  AUTH_FAILURE = "AUTH_FAILURE",
  NETWORK_FAILURE = "NETWORK_FAILURE",
}

export type TerminationKind = "graceful" | "hard";

export interface RecoveryOutcome {
  resolved: boolean;
  terminationKind: TerminationKind;
  stateCheckpointed: boolean;
  qualityFlagEmitted: boolean;
  message: string;
}

export abstract class AgentFailureError extends Error {
  abstract readonly failureType: FailureType;
  readonly originNode: string;
  readonly attemptCount: number;

  constructor(message: string, originNode: string, attemptCount = 1) {
    super(message);
    this.originNode = originNode;
    this.attemptCount = attemptCount;
    this.name = this.constructor.name;
  }
}
