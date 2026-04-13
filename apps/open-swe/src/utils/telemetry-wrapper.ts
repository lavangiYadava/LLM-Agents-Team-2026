import type { NodeName, NodeRecord } from "@openswe/shared/telemetry";
import { TelemetryCollector } from "@openswe/shared/telemetry";
import type { GraphConfig } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "./logger.js";

const telemetryLogger = createLogger(LogLevel.INFO, "telemetry");
export const collectors = new Map<string, TelemetryCollector>();

export function timed<T extends (state: any, config: any) => Promise<any>>(
  nodeId: NodeName,
  fn: T,
): T {
  return (async (state: any, config: any) => {
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
  }) as T;
}
