import { END, START, StateGraph } from "@langchain/langgraph";
import {
  PlannerGraphState,
  PlannerGraphStateObj,
} from "@openswe/shared/open-swe/planner/types";
import { GraphConfiguration } from "@openswe/shared/open-swe/types";
import {
  generateAction,
  generatePlan,
  interruptProposedPlan,
  prepareGraphState,
  notetaker,
  takeActions,
  determineNeedsContext,
} from "./nodes/index.js";
import { isAIMessage } from "@langchain/core/messages";
import { initializeSandbox } from "../shared/initialize-sandbox.js";
import { diagnoseError } from "../shared/diagnose-error.js";
import type { NodeName } from "@openswe/shared/telemetry";
import { collectors, timed } from "../../utils/telemetry-wrapper.js";

void collectors;

function takeActionOrGeneratePlan(
  state: PlannerGraphState,
): "take-plan-actions" | "generate-plan" {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    return "take-plan-actions";
  }

  // If the last message does not have tool calls, continue to generate plan without modifications.
  return "generate-plan";
}

const workflow = new StateGraph(PlannerGraphStateObj, GraphConfiguration)
  .addNode(
    "prepare-graph-state",
    timed("prepare-graph-state" as NodeName, prepareGraphState),
    {
      ends: [END, "initialize-sandbox"],
    },
  )
  .addNode(
    "initialize-sandbox",
    timed("initialize-sandbox" as NodeName, initializeSandbox),
  )
  .addNode(
    "generate-plan-context-action",
    timed("generate-plan-context-action" as NodeName, generateAction),
  )
  .addNode(
    "take-plan-actions",
    timed("take-plan-actions" as NodeName, takeActions),
    {
      ends: ["generate-plan-context-action", "diagnose-error", "generate-plan"],
    },
  )
  .addNode("generate-plan", timed("generate-plan" as NodeName, generatePlan))
  .addNode("notetaker", timed("notetaker" as NodeName, notetaker))
  .addNode(
    "interrupt-proposed-plan",
    timed("interrupt-proposed-plan" as NodeName, interruptProposedPlan),
    {
      ends: [END, "determine-needs-context"],
    },
  )
  .addNode(
    "determine-needs-context",
    timed("determine-needs-context" as NodeName, determineNeedsContext),
    {
      ends: ["generate-plan-context-action", "generate-plan"],
    },
  )
  .addNode("diagnose-error", timed("diagnose-error" as NodeName, diagnoseError))
  .addEdge(START, "prepare-graph-state")
  .addEdge("initialize-sandbox", "generate-plan-context-action")
  .addConditionalEdges(
    "generate-plan-context-action",
    takeActionOrGeneratePlan,
    ["take-plan-actions", "generate-plan"],
  )
  .addEdge("diagnose-error", "generate-plan-context-action")
  .addEdge("generate-plan", "notetaker")
  .addEdge("notetaker", "interrupt-proposed-plan");

export const graph = workflow.compile();
graph.name = "Open SWE - Planner";
