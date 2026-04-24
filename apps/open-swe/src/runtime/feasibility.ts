import { FeasibilityResult } from "@openswe/shared/open-swe/types";

export interface TaskContext {
  issue_body: string;
  referenced_file_count: number;
  repo_line_count: number;
}

export interface BudgetConfig {
  maxTokens: number;
  maxToolCalls: number;
  maxActions: number;
}

export function checkFeasibility(
  config: BudgetConfig,
  context: TaskContext,
): FeasibilityResult {
  const base_tokens = 2000;
  const issue_tokens = Math.ceil(context.issue_body.length / 4);
  const file_tokens = context.referenced_file_count * 800;
  const repo_tokens = Math.min(
    Math.ceil(context.repo_line_count / 10),
    8000,
  );
  const estimated_tokens =
    base_tokens + issue_tokens + file_tokens + repo_tokens;

  const estimated_tool_calls = context.referenced_file_count * 3 + 4;

  const feasible =
    estimated_tokens <= config.maxTokens &&
    estimated_tool_calls <= config.maxToolCalls;

  let confidence: "low" | "medium" | "high";
  if (estimated_tokens < config.maxTokens * 0.6) {
    confidence = "high";
  } else if (estimated_tokens < config.maxTokens * 0.85) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  let warning: string | undefined;
  if (!feasible) {
    warning = `Task exceeds budget: estimated ${estimated_tokens} tokens and ${estimated_tool_calls} tool calls against limits of ${config.maxTokens} tokens and ${config.maxToolCalls} tool calls.`;
  } else if (confidence === "low") {
    warning = `Task is near budget limits: estimated ${estimated_tokens} tokens (${Math.round((estimated_tokens / config.maxTokens) * 100)}% of token budget).`;
  }

  return {
    estimated_tokens,
    estimated_tool_calls,
    feasible,
    confidence,
    warning,
  };
}
