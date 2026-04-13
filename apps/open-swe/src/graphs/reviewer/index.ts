import { END, START, StateGraph } from "@langchain/langgraph";
import {
  ReviewerGraphState,
  ReviewerGraphStateObj,
} from "@openswe/shared/open-swe/reviewer/types";
import {
  GraphConfig,
  GraphConfiguration,
} from "@openswe/shared/open-swe/types";
import {
  finalReview,
  generateReviewActions,
  initializeState,
  takeReviewerActions,
} from "./nodes/index.js";
import { isAIMessage } from "@langchain/core/messages";
import { diagnoseError } from "../shared/diagnose-error.js";
import { TelemetryCollector } from "@openswe/shared/telemetry";
import type { NodeName, NodeRecord } from "@openswe/shared/telemetry";
import { createLogger, LogLevel } from "../../utils/logger.js";

const telemetryLogger = createLogger(LogLevel.INFO, "telemetry");
const collectors = new Map<string, TelemetryCollector>();

function timed(
  nodeId: NodeName,
  fn: (state: any, config: GraphConfig) => Promise<any> | any,
): typeof fn {
  return (async (state, config) => {
    const threadId =
      (config as GraphConfig)?.configurable?.thread_id ?? crypto.randomUUID();

    if (!collectors.has(threadId)) {
      collectors.set(threadId, new TelemetryCollector(threadId));
    }
    const collector = collectors.get(threadId)!;

    const start = Date.now();
    const result = await fn(state, config);
    const wallClockMs = Date.now() - start;

    const messages: any[] = (result as any).messages ?? [];
    const lastAI = [...messages]
      .reverse()
      .find((m: any) => m._getType?.() === "ai");
    const toolMessages = messages.filter((m: any) => m._getType?.() === "tool");

    const entry: NodeRecord = {
      runId: threadId,
      node: nodeId,
      step: collector.recordCount(),
      wallClockMs,
      inputTokens: lastAI?.usage_metadata?.input_tokens ?? 0,
      outputTokens: lastAI?.usage_metadata?.output_tokens ?? 0,
      toolEvents: toolMessages.map((m: any) => ({
        toolName: m.name ?? m.tool_call_id ?? "unknown",
        success:
          typeof m.content === "string" ? !m.content.startsWith("Error") : true,
      })),
      outputSnapshot:
        typeof lastAI?.content === "string" ? lastAI.content.slice(0, 200) : "",
      modelId: (config as any)?.metadata?.ls_model_name ?? "unknown",
      modelTier: undefined,
    };

    collector.record(entry);
    telemetryLogger.info("node_complete", entry);

    return result;
  }) as typeof fn;
}

function takeReviewActionsOrFinalReview(
  state: ReviewerGraphState,
): "take-review-actions" | "final-review" {
  const { reviewerMessages } = state;
  const lastMessage = reviewerMessages[reviewerMessages.length - 1];

  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    return "take-review-actions";
  }

  // If the last message does not have tool calls, continue to generate the final review.
  return "final-review";
}

const workflow = new StateGraph(ReviewerGraphStateObj, GraphConfiguration)
  .addNode(
    "initialize-state",
    timed("initialize-state" as NodeName, initializeState),
  )
  .addNode(
    "generate-review-actions",
    timed("generate-review-actions" as NodeName, generateReviewActions),
  )
  .addNode(
    "take-review-actions",
    timed("take-review-actions" as NodeName, takeReviewerActions),
    {
      ends: [
        "generate-review-actions",
        "diagnose-reviewer-error",
        "final-review",
      ],
    },
  )
  .addNode(
    "diagnose-reviewer-error",
    timed("diagnose-reviewer-error" as NodeName, diagnoseError),
  )
  .addNode("final-review", timed("final-review" as NodeName, finalReview))
  .addEdge(START, "initialize-state")
  .addEdge("initialize-state", "generate-review-actions")
  .addConditionalEdges(
    "generate-review-actions",
    takeReviewActionsOrFinalReview,
    ["take-review-actions", "final-review"],
  )
  .addEdge("diagnose-reviewer-error", "generate-review-actions")
  .addEdge("final-review", END);

export const graph = workflow.compile();
graph.name = "Open SWE - Reviewer";
