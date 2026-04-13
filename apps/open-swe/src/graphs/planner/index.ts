import { END, START, StateGraph } from "@langchain/langgraph";
import {
  PlannerGraphState,
  PlannerGraphStateObj,
} from "@openswe/shared/open-swe/planner/types";
import {
  GraphConfig,
  GraphConfiguration,
} from "@openswe/shared/open-swe/types";
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
