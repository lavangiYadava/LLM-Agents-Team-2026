import { AgentFailureError, FailureType } from "./types.js";

export class ApiTimeoutError extends AgentFailureError {
  readonly failureType = FailureType.API_TIMEOUT;
  readonly statusCode: number;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    statusCode: number,
  ) {
    super(message, originNode, attemptCount);
    this.statusCode = statusCode;
  }
}

export class BudgetExhaustedError extends AgentFailureError {
  readonly failureType = FailureType.BUDGET_EXHAUSTED;
  readonly dimension: "tokens" | "toolCalls" | "actions";

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    dimension: "tokens" | "toolCalls" | "actions",
  ) {
    super(message, originNode, attemptCount);
    this.dimension = dimension;
  }
}

export class ToolIntegrationError extends AgentFailureError {
  readonly failureType = FailureType.TOOL_INTEGRATION;
  readonly toolName: string;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    toolName: string,
  ) {
    super(message, originNode, attemptCount);
    this.toolName = toolName;
  }
}

export class QualityDegradationError extends AgentFailureError {
  readonly failureType = FailureType.QUALITY_DEGRADATION;
  readonly validationDetails: string;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    validationDetails: string,
  ) {
    super(message, originNode, attemptCount);
    this.validationDetails = validationDetails;
  }
}

export class ContextOverflowError extends AgentFailureError {
  readonly failureType = FailureType.CONTEXT_OVERFLOW;

  constructor(message: string, originNode: string, attemptCount = 1) {
    super(message, originNode, attemptCount);
  }
}

export class LoopOverextensionError extends AgentFailureError {
  readonly failureType = FailureType.LOOP_OVEREXTENSION;
  readonly loopCount: number;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    loopCount: number,
  ) {
    super(message, originNode, attemptCount);
    this.loopCount = loopCount;
  }
}

export class ModelUnavailableError extends AgentFailureError {
  readonly failureType = FailureType.MODEL_UNAVAILABLE;
  readonly modelId: string;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    modelId: string,
  ) {
    super(message, originNode, attemptCount);
    this.modelId = modelId;
  }
}

export class RateLimitingError extends AgentFailureError {
  readonly failureType = FailureType.RATE_LIMITING;
  readonly retryAfterMs: number;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    retryAfterMs: number,
  ) {
    super(message, originNode, attemptCount);
    this.retryAfterMs = retryAfterMs;
  }
}

export class SandboxFailureError extends AgentFailureError {
  readonly failureType = FailureType.SANDBOX_FAILURE;
  readonly exitCode: number | null;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    exitCode: number | null,
  ) {
    super(message, originNode, attemptCount);
    this.exitCode = exitCode;
  }
}

export class MalformedOutputError extends AgentFailureError {
  readonly failureType = FailureType.MALFORMED_OUTPUT;
  readonly rawOutput: string;

  constructor(
    message: string,
    originNode: string,
    attemptCount = 1,
    rawOutput: string,
  ) {
    super(message, originNode, attemptCount);
    this.rawOutput = rawOutput;
  }
}

export class AuthFailureError extends AgentFailureError {
  readonly failureType = FailureType.AUTH_FAILURE;

  constructor(message: string, originNode: string, attemptCount = 1) {
    super(message, originNode, attemptCount);
  }
}

export class NetworkFailureError extends AgentFailureError {
  readonly failureType = FailureType.NETWORK_FAILURE;

  constructor(message: string, originNode: string, attemptCount = 1) {
    super(message, originNode, attemptCount);
  }
}
