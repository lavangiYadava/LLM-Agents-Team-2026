import {
  GraphState,
  LoopMetadata,
} from "@openswe/shared/open-swe/types";
import { BudgetState } from "@openswe/shared/open-swe/budget-types";
import {
  checkFeasibility,
  TaskContext,
  BudgetConfig,
} from "./feasibility.js";
import {
  evaluateLoopPolicy,
  LoopPolicyConfig,
  LoopDecision,
} from "./loop-policy.js";
import { checkpointState } from "./failure/checkpoint.js";
import { createLogger, LogLevel } from "../utils/logger.js";

export interface RuntimeConfig {
  budget: BudgetConfig;
  loop: LoopPolicyConfig;
}

export class RuntimeController {
  private readonly config: RuntimeConfig;
  protected readonly logger: ReturnType<typeof createLogger>;
  private readonly _checkFeasibility: typeof checkFeasibility;
  private readonly _evaluatePolicy: (
    state: GraphState,
    budget: BudgetState,
    config: LoopPolicyConfig,
  ) => LoopDecision;

  constructor(
    config: RuntimeConfig,
    checkFeasibilityFn: typeof checkFeasibility = checkFeasibility,
    evaluatePolicyFn: typeof evaluateLoopPolicy = evaluateLoopPolicy,
  ) {
    this.config = config;
    this.logger = createLogger(LogLevel.INFO, "RuntimeController");
    this._checkFeasibility = checkFeasibilityFn;
    this._evaluatePolicy = evaluatePolicyFn;
  }

  async preRun(context: TaskContext): Promise<GraphState["loop_metadata"]> {
    const feasibility_result = this._checkFeasibility(
      this.config.budget,
      context,
    );

    if (!feasibility_result.feasible) {
      this.logger.warn("Task may exceed budget limits.", feasibility_result);
    }

    const metadata: LoopMetadata = {
      iteration_count: 0,
      programmer_iterations: 0,
      reviewer_cycles: 0,
      last_node: null,
      termination_reason: null,
      wall_clock_start_ms: Date.now(),
      feasibility_result,
    };

    return metadata;
  }

  async afterNode(
    state: GraphState,
    budgetState: BudgetState,
    completedNodeName: string,
  ): Promise<GraphState> {
    this.logger.info("afterNode", { node: completedNodeName });

    const existing: LoopMetadata = state.loop_metadata ?? {
      iteration_count: 0,
      programmer_iterations: 0,
      reviewer_cycles: 0,
      last_node: null,
      termination_reason: null,
      wall_clock_start_ms: Date.now(),
      feasibility_result: null,
    };

    const updatedMeta: LoopMetadata = {
      ...existing,
      iteration_count: existing.iteration_count + 1,
      programmer_iterations:
        completedNodeName === "programmer"
          ? existing.programmer_iterations + 1
          : existing.programmer_iterations,
      reviewer_cycles:
        completedNodeName === "reviewer"
          ? existing.reviewer_cycles + 1
          : existing.reviewer_cycles,
      last_node: completedNodeName,
    };

    const updatedState: GraphState = {
      ...state,
      loop_metadata: updatedMeta,
    };

    const decision = this._evaluatePolicy(
      updatedState,
      budgetState,
      this.config.loop,
    );

    if (decision.action === "degrade") {
      const degradedMeta: LoopMetadata = {
        ...updatedMeta,
        termination_reason: decision.reason,
      };
      this.logger.warn("Loop policy triggered degradation.", {
        reason: decision.reason,
      });
      return { ...updatedState, loop_metadata: degradedMeta };
    }

    if (decision.action === "terminate") {
      const terminatedMeta: LoopMetadata = {
        ...updatedMeta,
        termination_reason: decision.reason,
      };
      const terminatedState: GraphState = {
        ...updatedState,
        loop_metadata: terminatedMeta,
      };
      await checkpointState(terminatedState, {});
      this.logger.warn("Loop policy triggered termination.", {
        reason: decision.reason,
        mode: decision.mode,
      });
      return terminatedState;
    }

    return updatedState;
  }
}
