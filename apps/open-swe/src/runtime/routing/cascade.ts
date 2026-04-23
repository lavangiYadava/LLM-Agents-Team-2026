import type { AIMessageChunk } from "@langchain/core/messages";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { ModelTier, escalateTier } from "./model-tiers.js";

export interface QualityCheckResult {
  passed: boolean;
  reason?: string;
}

const REFUSAL_PATTERNS = [
  /\bi cannot\b/i,
  /\bi can't\b/i,
  /\bas an ai\b/i,
  /\bi'm not able to\b/i,
  /\bi am not able to\b/i,
  /\bi'm unable to\b/i,
  /\bi am unable to\b/i,
];

/**
 * Check structural quality signals in an LLM response.
 * This is NOT a semantic quality check — it detects obvious failures
 * like empty output, malformed tool calls, refusals, and truncation.
 */
export function checkOutputQuality(
  response: AIMessageChunk,
  task: LLMTask,
): QualityCheckResult {
  // 1. Empty response (no content + no tool calls)
  const hasContent = response.content != null && response.content !== "";
  const toolCalls = response.tool_calls ?? [];
  const hasToolCalls = toolCalls.length > 0;

  if (!hasContent && !hasToolCalls) {
    return { passed: false, reason: "empty_response" };
  }

  // 2. Malformed tool calls (name present but args missing/invalid)
  for (const tc of toolCalls) {
    if (tc.name && (tc.args === undefined || tc.args === null)) {
      return { passed: false, reason: "malformed_tool_call" };
    }
  }

  // 3. Model refusal patterns (only check for PROGRAMMER task where action is expected)
  if (task === LLMTask.PROGRAMMER && hasContent) {
    const contentStr =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .filter(
                (block): block is { type: "text"; text: string } =>
                  typeof block === "object" &&
                  block !== null &&
                  "type" in block &&
                  block.type === "text",
              )
              .map((block) => block.text)
              .join(" ")
          : "";

    if (contentStr && REFUSAL_PATTERNS.some((p) => p.test(contentStr))) {
      return { passed: false, reason: "model_refusal" };
    }
  }

  // 4. Truncated output (finish_reason === "length")
  const metadata = response.response_metadata;
  if (metadata) {
    const finishReason =
      metadata.finish_reason ?? metadata.stop_reason ?? metadata.finishReason;
    if (finishReason === "length") {
      return { passed: false, reason: "truncated_output" };
    }
  }

  return { passed: true };
}

export interface CascadeDecision {
  shouldEscalate: boolean;
  targetTier?: ModelTier;
  reason?: string;
}

/**
 * Decide whether to escalate to a higher tier after a quality failure.
 *
 * Rules:
 * - Only escalate ONE step (ECONOMY→STANDARD, STANDARD→PREMIUM)
 * - If already at PREMIUM → no escalation
 * - If budget is exhausted → no escalation
 */
export function decideCascade(
  currentTier: ModelTier,
  qualityResult: QualityCheckResult,
  budgetExhausted: boolean,
): CascadeDecision {
  if (qualityResult.passed) {
    return { shouldEscalate: false };
  }

  if (budgetExhausted) {
    return { shouldEscalate: false, reason: "budget_exhausted" };
  }

  const nextTier = escalateTier(currentTier);
  if (nextTier === null) {
    return { shouldEscalate: false, reason: "already_premium" };
  }

  return {
    shouldEscalate: true,
    targetTier: nextTier,
    reason: qualityResult.reason,
  };
}
