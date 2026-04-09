import type { RunnableConfig } from "@langchain/core/runnables";
import {
  AgentFailureError,
  FailureType,
  RecoveryOutcome,
} from "@openswe/shared/failure";
import type { GraphState } from "@openswe/shared/open-swe/types";
import type { BudgetState } from "../budget/index.js";
import { checkpointState } from "./checkpoint.js";
import { createLogger, LogLevel } from "../../utils/logger.js";
import { handleApiTimeout } from "./policies/api-timeout.js";
import { handleBudgetExhausted } from "./policies/budget-exhausted.js";
import { handleMalformedOutput } from "./policies/malformed-output.js";
import { handleQualityDegradation } from "./policies/quality-degradation.js";
import { handleContextOverflow } from "./policies/context-overflow.js";
import { handleModelUnavailable } from "./policies/model-unavailable.js";
import { handleLoopOverextension } from "./policies/loop-overextension.js";
import { handleRateLimiting } from "./policies/rate-limiting.js";
import { handleSandboxFailure } from "./policies/sandbox-failure.js";
import { handleToolIntegration } from "./policies/tool-integration.js";
import { handleAuthFailure } from "./policies/auth-failure.js";
import { handleNetworkFailure } from "./policies/network-failure.js";

type PolicyFn = (
  error: AgentFailureError,
  state: GraphState,
  config: RunnableConfig,
  budget: BudgetState,
) => Promise<RecoveryOutcome>;

const logger = createLogger(LogLevel.INFO, "failure:handler");

const POLICY_MAP: Record<FailureType, PolicyFn> = {
  [FailureType.API_TIMEOUT]: handleApiTimeout,
  [FailureType.BUDGET_EXHAUSTED]: handleBudgetExhausted,
  [FailureType.TOOL_INTEGRATION]: handleToolIntegration,
  [FailureType.QUALITY_DEGRADATION]: handleQualityDegradation,
  [FailureType.CONTEXT_OVERFLOW]: handleContextOverflow,
  [FailureType.LOOP_OVEREXTENSION]: handleLoopOverextension,
  [FailureType.MODEL_UNAVAILABLE]: handleModelUnavailable,
  [FailureType.RATE_LIMITING]: handleRateLimiting,
  [FailureType.SANDBOX_FAILURE]: handleSandboxFailure,
  [FailureType.MALFORMED_OUTPUT]: handleMalformedOutput,
  [FailureType.AUTH_FAILURE]: handleAuthFailure,
  [FailureType.NETWORK_FAILURE]: handleNetworkFailure,
};

export class FailureHandler {
  constructor(private readonly budgetState: BudgetState) {}

  async dispatch(
    error: AgentFailureError,
    state: GraphState,
    config: RunnableConfig,
  ): Promise<RecoveryOutcome> {
    logger.info("Dispatching failure policy.", {
      failureType: error.failureType,
      originNode: error.originNode,
      attemptCount: error.attemptCount,
      message: error.message,
    });

    await checkpointState(state, config);

    const policy = POLICY_MAP[error.failureType];
    const result = await policy(error, state, config, this.budgetState);

    logger.info("Failure policy resolved.", {
      failureType: error.failureType,
      resolved: result.resolved,
      terminationKind: result.terminationKind,
      stateCheckpointed: result.stateCheckpointed,
      qualityFlagEmitted: result.qualityFlagEmitted,
    });

    return result;
  }
}
