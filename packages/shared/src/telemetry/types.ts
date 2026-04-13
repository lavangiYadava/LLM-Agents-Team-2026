export type NodeName = "manager" | "planner" | "programmer" | "reviewer";

export interface ToolEvent {
  toolName: string;
  success: boolean;
}

export interface NodeRecord {
  runId: string;
  node: NodeName;
  step: number;
  wallClockMs: number;
  inputTokens: number;
  outputTokens: number;
  toolEvents: ToolEvent[];
  outputSnapshot: string;
  modelId: string;
  modelTier?: "LOW" | "MID" | "HIGH";
}

export interface RunSummary {
  runId: string;
  durationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  totalToolFailures: number;
  records: NodeRecord[];
}
