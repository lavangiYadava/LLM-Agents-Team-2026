import { END, START, StateGraph } from "@langchain/langgraph";
import {
  ReviewerGraphState,
  ReviewerGraphStateObj,
} from "@openswe/shared/open-swe/reviewer/types";
import { GraphConfiguration } from "@openswe/shared/open-swe/types";
import {
  finalReview,
  generateReviewActions,
  initializeState,
  takeReviewerActions,
} from "./nodes/index.js";
import { isAIMessage } from "@langchain/core/messages";
import { diagnoseError } from "../shared/diagnose-error.js";
import type { NodeName } from "@openswe/shared/telemetry";
import { collectors, timed } from "../../utils/telemetry-wrapper.js";

void collectors;

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
