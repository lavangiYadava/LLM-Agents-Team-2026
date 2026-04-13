import { END, START, StateGraph } from "@langchain/langgraph";
import {
  GraphConfig,
  GraphConfiguration,
} from "@openswe/shared/open-swe/types";
import { ManagerGraphStateObj } from "@openswe/shared/open-swe/manager/types";
import {
  initializeGithubIssue,
  classifyMessage,
  startPlanner,
  createNewSession,
} from "./nodes/index.js";
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

const workflow = new StateGraph(ManagerGraphStateObj, GraphConfiguration)
  .addNode(
    "initialize-github-issue",
    timed("initialize-github-issue" as NodeName, initializeGithubIssue),
  )
  .addNode(
    "classify-message",
    timed("classify-message" as NodeName, classifyMessage),
    {
      ends: [END, "start-planner", "create-new-session"],
    },
  )
  .addNode(
    "create-new-session",
    timed("create-new-session" as NodeName, createNewSession),
  )
  .addNode("start-planner", timed("start-planner" as NodeName, startPlanner))
  .addEdge(START, "initialize-github-issue")
  .addEdge("initialize-github-issue", "classify-message")
  .addEdge("create-new-session", END)
  .addEdge("start-planner", END);

export const graph = workflow.compile();
graph.name = "Open SWE - Manager";
