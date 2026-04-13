To run all tests: `yarn test`

To run specific tests: `yarn test:single ` followed by the path of the .test.ts file

# Test Coverage

## Telemetry

Covers the structured logging layer that records per-node execution data
across the manager, planner, programmer, and reviewer graphs.

### `packages/shared/src/telemetry/__tests__/collector.test.ts`
Unit tests for `TelemetryCollector` — the pure data store that accumulates
node records within a single run.

- Initial state: record count starts at zero
- Accumulation: `record()` appends and `recordCount()` reflects each addition
- Aggregation: `summarize()` correctly sums `inputTokens`, `outputTokens`,
  and `totalToolCalls` across all records
- Failure counting: `totalToolFailures` counts only `success === false` tool
  events, not all tool events
- Edge cases: empty records, empty `toolEvents` arrays, and
  `modelTier: undefined` all handled without errors
- Identity: `summary.runId` matches the value passed to the constructor

### `apps/open-swe/src/utils/__tests__/telemetry-wrapper.test.ts`
Unit tests for `timed()` — the wrapper applied to each graph node that
observes inputs/outputs without modifying node behavior.

- Passthrough: underlying node receives the same state and config; return
  value is unchanged
- Timing: `wallClockMs` is non-negative and reflects actual elapsed time
- Token extraction: reads `input_tokens` / `output_tokens` from the last
  `AIMessage`'s `usage_metadata`; defaults to `0` when absent
- Tool events: one `ToolEvent` produced per `ToolMessage`; `toolName` falls
  back from `name` → `tool_call_id` → `"unknown"`; `success: false` when
  content starts with `"Error"`
- Output snapshot: first 200 characters of last `AIMessage` content;
  empty string when absent or non-string
- Collector isolation: separate `TelemetryCollector` per `thread_id`;
  same `thread_id` reuses the existing collector; `step` increments correctly
- Model identity: `modelId` read from `config.metadata.ls_model_name`;
  defaults to `"unknown"`

### `apps/open-swe/src/utils/__tests__/telemetry-integration.int.test.ts`
Integration test validating the full pipeline from `timed()` invocation
through to `collector.summarize()` output, using a fake node function
with no real API calls.

- A single node invocation produces exactly one record in `RunSummary`
- Token counts, tool events, `modelId`, `outputSnapshot`, and `runId`
  all propagate correctly from the fake node response to the summary
