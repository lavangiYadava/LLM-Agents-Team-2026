import type { NodeRecord, RunSummary } from "./types.js";

export class TelemetryCollector {
  private records: NodeRecord[] = [];
  private readonly startMs: number;

  constructor(readonly runId: string) {
    this.startMs = Date.now();
  }

  record(entry: NodeRecord): void {
    this.records.push(entry);
  }

  recordCount(): number {
    return this.records.length;
  }

  summarize(): RunSummary {
    return {
      runId: this.runId,
      durationMs: Date.now() - this.startMs,
      totalInputTokens: this.records.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: this.records.reduce((s, r) => s + r.outputTokens, 0),
      totalToolCalls: this.records.reduce((s, r) => s + r.toolEvents.length, 0),
      totalToolFailures: this.records.reduce(
        (s, r) => s + r.toolEvents.filter((e) => !e.success).length,
        0,
      ),
      records: this.records,
    };
  }
}
