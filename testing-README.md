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

## Failure Handling

Covers the policy-driven recovery layer in `apps/open-swe/src/runtime/failure/`, including typed failure classification, recovery dispatch, checkpointing, and Manager integration.

### `apps/open-swe/src/__tests__/failure/policies/*.test.ts`
Unit tests for each recovery policy, one file per failure type.

- API timeout: retries with exponential backoff, downgrades tier on repeated failures, hard-stops after retry budget is exhausted
- Budget exhausted: checkpoints state, injects `degradationSignal`, returns graceful partial-stop outcome
- Malformed output: sets `reflexionContext` on first attempt, hard-stops after the Reflexion retry limit
- Quality degradation: upgrades model tier when budget allows, otherwise sets `qualityFlag`
- Context overflow: upgrades to a higher-context tier when possible, otherwise checkpoints and hard-stops
- Loop overextension: allows one more pass when budget allows, otherwise checkpoints and terminates gracefully
- Model unavailable: falls through to the next tier immediately, hard-stops if no tier remains
- Rate limiting: waits within the wall-clock budget, downgrades tier when wait is too long
- Sandbox failure: attempts sandbox restart, marks the run `unsolvable` if restart fails
- Tool integration error: switches to a backup tool when available, checkpoints and hard-stops otherwise
- Authentication failure: always checkpoints and hard-stops with no retry
- Network failure: retries within the remaining token-budget fraction, hard-stops when retry budget is exhausted

### `apps/open-swe/src/__tests__/failure/handler-contracts.test.ts`
Contract tests for `FailureHandler` dispatch behavior.

- Exhaustiveness: every `FailureType` resolves to a registered policy
- Shape: every dispatch returns a valid `RecoveryOutcome`
- Safety: dispatch never throws for a typed failure
- Invariants: hard-stop outcomes report `stateCheckpointed: true` and graceful outcomes preserve the expected flags

### `apps/open-swe/src/__tests__/failure/manager-integration.test.ts`
Integration tests for the Manager node’s failure wiring.

- Proactive loop detection: `reviewerCycleCount >= 2` triggers `LoopOverextensionError` before core logic runs
- Typed failures: `AgentFailureError` instances are dispatched directly to `FailureHandler`
- Unknown failures: non-typed errors are wrapped into a safe fallback error before dispatch
- Termination: unrecoverable outcomes return `{ terminated: true, terminationKind, terminationMessage }`
- State passthrough: policy-injected fields like `degradationSignal`, `reflexionContext`, `activeToolOverride`, and `qualityFlag` are preserved in the returned state delta

### `apps/open-swe/src/__tests__/failure/checkpoint.test.ts`
Unit tests for checkpoint persistence.

- Writes a `failureCheckpoint` record into `config.configurable`
- Captures `checkpointedAt`, `nodeSnapshot`, `iterationCount`, and `tokenUsage`
- Handles missing `configurable` without throwing
- Supports repeated calls by overwriting with the latest snapshot

### `apps/open-swe/src/__tests__/failure/invariants.test.ts`
Cross-cutting invariant tests across all failure policies.

- Hard termination always triggers checkpointing
- `stateCheckpointed` matches whether `checkpointState` was actually called
- `qualityFlagEmitted` always corresponds to a populated `state.qualityFlag`
- Recovery flags stay consistent across graceful and hard-stop paths