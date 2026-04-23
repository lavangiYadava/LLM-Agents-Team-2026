# Runtime Layer: Clustering-Based Budget-Aware Model Routing

## Overview

Build a runtime layer that intercepts every LLM call in OpenSWE, embeds the prompt, maps it to a query cluster, and routes it to the most cost-effective model for that cluster — all while respecting a global budget constraint. When a routed model produces low-quality output, a one-step cascade escalates to a higher tier. The layer sits between the graph nodes and the existing `ModelManager`, requiring zero changes to node-level code.

**Key approach**: Clustering-based routing (inspired by UniRoute) + one-step cascading (inspired by FrugalGPT). Queries are embedded and assigned to clusters. Each cluster has a pre-computed performance profile per model tier. At runtime, the router picks the cheapest model that meets a quality threshold for the query's cluster, constrained by remaining budget. If the output fails a quality gate, the query is escalated to the next tier.

### Why clustering over static task-tier mapping?

Within a single `LLMTask` like `PROGRAMMER`, query difficulty varies wildly:
- "List files in src/" → trivial, haiku-class can handle it
- "Refactor the auth module to use JWT" → complex, needs opus-class

Static task-tier mapping treats all PROGRAMMER calls the same. Clustering captures this variance without manual labeling. It also allows **adding new models at inference time** — just evaluate them on existing clusters to get a performance profile, no retraining needed.

---

## Architecture Context

### How OpenSWE calls LLMs today

```
Graph Node (e.g. generateAction)
  → loadModel(config, task)                     // apps/open-swe/src/utils/llms/load-model.ts
    → getModelManager().loadModel(config, task)  // singleton ModelManager
      → getBaseConfigForTask(config, task)       // reads config.configurable.[task]ModelName
      → initializeModel(config, graphConfig)     // calls initChatModel() from langchain
    → new FallbackRunnable(model, ...)           // wraps model with circuit-breaker fallback
      → .invoke()                                // iterates providers on failure
```

**Key insight**: Every single LLM call (17+ call sites across planner, programmer, reviewer, router, summarizer) flows through one function: `loadModel()` → `ModelManager.loadModel()` → `FallbackRunnable.invoke()`.

### Existing token tracking

- `GraphState.tokenData: ModelTokenData[]` — accumulates `{ model, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens }` per model across the entire run
- `tokenDataReducer` in `packages/shared/src/caching.ts` merges entries by model name
- `calculateCostSavings()` computes costs (currently hardcoded to Sonnet 4 rates)
- `MAX_INTERNAL_TOKENS = 80_000` triggers history summarization

### Existing fallback system

`FallbackRunnable` already implements provider-level circuit-breaker fallback (anthropic → openai → google-genai). Our layer works **above** this — we choose which model to route to, and the fallback system handles provider failures within that tier.

---

## Implementation Plan

### Phase 1: Model Tier Registry & Cost Table (Capacity Tiering)

**Goal**: Define model tiers (capacity tiers) and their cost/capability profiles. Following the Capacity Tiering pattern, we explicitly define LOW, MID, and HIGH compute budgets by swapping the backbone LLM while keeping the pipeline interface fixed.

**New file**: `apps/open-swe/src/utils/runtime/model-tiers.ts`

```ts
export enum ModelTier {
  PREMIUM = "premium",     // HIGH capacity: opus-class
  STANDARD = "standard",   // MID capacity: sonnet-class
  ECONOMY = "economy",     // LOW capacity: haiku-class
}

export interface ModelTierConfig {
  tier: ModelTier;
  models: Record<Provider, string>;  // provider → model name
  costPerInputMTok: number;          // $/MTok input
  costPerOutputMTok: number;         // $/MTok output
  maxContextWindow: number;
}
```

| Tier | Capacity | Anthropic | OpenAI | Google | Input $/MTok | Output $/MTok |
|------|----------|-----------|--------|--------|-------------|---------------|
| PREMIUM | HIGH | claude-opus-4-5 | gpt-5-codex | gemini-3-pro-preview | ~15.00 | ~75.00 |
| STANDARD | MID | claude-sonnet-4-5 | gpt-5-mini | gemini-2.5-pro | ~3.00 | ~15.00 |
| ECONOMY | LOW | claude-haiku-4-5 | gpt-5-nano | gemini-2.5-flash | ~0.80 | ~4.00 |

The pipeline interface (`ModelManager.loadModel()` → `initChatModel()`) stays fixed across all tiers — only the model name string changes.

---

### Phase 2: Query Cluster Definitions & Profiles

**Goal**: Define clusters of query types that emerge in coding agent workloads, and assign a quality profile per cluster per model tier.

**New file**: `apps/open-swe/src/utils/runtime/query-clusters.ts`

#### Cluster Definitions

We define clusters based on the **types of prompts** that flow through OpenSWE's agent loop. These are seeded as heuristic clusters using keyword/structural features, with the option to refine via actual embeddings later.

```ts
export enum QueryCluster {
  // Simple, mechanical operations
  FILE_EXPLORATION = "file_exploration",     // ls, find, tree, read file
  SIMPLE_EDIT = "simple_edit",               // rename, small fix, format change
  COMMAND_EXECUTION = "command_execution",   // run tests, install deps, git ops

  // Moderate complexity
  CODE_GENERATION = "code_generation",       // write a function, add a route
  PLAN_UPDATE = "plan_update",               // update/revise task plan
  ERROR_DIAGNOSIS = "error_diagnosis",       // diagnose test failure, parse stack trace

  // High complexity
  COMPLEX_REFACTOR = "complex_refactor",     // restructure module, change architecture
  CROSS_FILE_REASONING = "cross_file_reasoning", // understand interactions across files
  CODE_REVIEW = "code_review",               // review PR, identify issues

  // Utility (always cheap)
  SUMMARIZATION = "summarization",           // summarize history, extract context
  ROUTING_CLASSIFICATION = "routing_classification", // classify intent, route message
}
```

#### Cluster-to-Tier Quality Profiles (Stage 1: Heuristic)

Each cluster has a **minimum viable tier** — the cheapest tier that produces acceptable quality. This is a heuristic starting point, refined by data later.

```ts
export const CLUSTER_QUALITY_PROFILES: Record<QueryCluster, {
  minViableTier: ModelTier;       // cheapest tier that works well
  preferredTier: ModelTier;       // tier that produces best results
  qualityDropoff: number;         // 0-1, how much quality drops when degraded
}> = {
  [QueryCluster.FILE_EXPLORATION]:        { minViableTier: ECONOMY,  preferredTier: ECONOMY,  qualityDropoff: 0.0 },
  [QueryCluster.SIMPLE_EDIT]:             { minViableTier: ECONOMY,  preferredTier: STANDARD, qualityDropoff: 0.1 },
  [QueryCluster.COMMAND_EXECUTION]:       { minViableTier: ECONOMY,  preferredTier: ECONOMY,  qualityDropoff: 0.0 },
  [QueryCluster.CODE_GENERATION]:         { minViableTier: STANDARD, preferredTier: PREMIUM,  qualityDropoff: 0.3 },
  [QueryCluster.PLAN_UPDATE]:             { minViableTier: STANDARD, preferredTier: PREMIUM,  qualityDropoff: 0.2 },
  [QueryCluster.ERROR_DIAGNOSIS]:         { minViableTier: STANDARD, preferredTier: PREMIUM,  qualityDropoff: 0.25 },
  [QueryCluster.COMPLEX_REFACTOR]:        { minViableTier: PREMIUM,  preferredTier: PREMIUM,  qualityDropoff: 0.5 },
  [QueryCluster.CROSS_FILE_REASONING]:    { minViableTier: PREMIUM,  preferredTier: PREMIUM,  qualityDropoff: 0.5 },
  [QueryCluster.CODE_REVIEW]:             { minViableTier: STANDARD, preferredTier: PREMIUM,  qualityDropoff: 0.3 },
  [QueryCluster.SUMMARIZATION]:           { minViableTier: ECONOMY,  preferredTier: ECONOMY,  qualityDropoff: 0.0 },
  [QueryCluster.ROUTING_CLASSIFICATION]:  { minViableTier: ECONOMY,  preferredTier: ECONOMY,  qualityDropoff: 0.0 },
};
```

#### Stage 2 Upgrade: Vectorized Cluster Profiles (UniRoute-style)

Replace static min/preferred tiers with a **K-dimensional error vector per model** (UniRoute methodology):

1. Apply K-means clustering to find K centroids from collected query embeddings
2. Partition a validation set into these K clusters
3. Evaluate each LLM on each cluster to obtain per-cluster error rates
4. Represent each LLM as a K-dimensional feature vector: `errorVector[k] = avg error on cluster k`
5. Routing rule: for query assigned to cluster k, select the LLM with the smallest `cost[model] × errorVector[model][k]`

```ts
// Stage 2 data structure
export interface VectorizedModelProfile {
  modelName: string;
  provider: Provider;
  costPerToken: number;
  clusterErrorVector: number[];  // K-dimensional: error rate per cluster
}

export function selectOptimalModel(
  cluster: number,
  models: VectorizedModelProfile[],
  remainingBudget: number,
): VectorizedModelProfile {
  // Select model with smallest cost-adjusted error for this cluster
  return models
    .filter(m => canAfford(m, remainingBudget))
    .sort((a, b) =>
      (a.costPerToken * a.clusterErrorVector[cluster]) -
      (b.costPerToken * b.clusterErrorVector[cluster])
    )[0];
}
```

This enables **adding new LLMs at inference time** — just evaluate them on existing clusters to populate their error vector, no retraining needed.

---

### Phase 3: Query Classifier

**Goal**: Given an incoming prompt + task type, classify it into a `QueryCluster`.

**New file**: `apps/open-swe/src/utils/runtime/query-classifier.ts`

#### Stage 1: Heuristic Classifier (ships first, no external deps)

Uses structural features of the prompt and the tool calls to classify:

```ts
export function classifyQuery(
  prompt: string,
  task: LLMTask,
  lastToolCalls?: ToolCall[],
): QueryCluster {
  // 1. Task-based shortcut: some tasks always map to a cluster
  if (task === LLMTask.ROUTER) return QueryCluster.ROUTING_CLASSIFICATION;
  if (task === LLMTask.SUMMARIZER) return QueryCluster.SUMMARIZATION;
  if (task === LLMTask.REVIEWER) return QueryCluster.CODE_REVIEW;

  // 2. Tool-call analysis: what tools were just used / requested?
  if (lastToolCalls?.some(tc => ["ls", "find", "cat", "tree"].includes(tc.name))) {
    return QueryCluster.FILE_EXPLORATION;
  }
  if (lastToolCalls?.some(tc => ["bash", "shell"].includes(tc.name))) {
    return QueryCluster.COMMAND_EXECUTION;
  }

  // 3. Keyword/pattern analysis on the prompt
  const promptLower = prompt.toLowerCase();

  if (/\b(refactor|restructure|redesign|migrate|rewrite)\b/.test(promptLower)) {
    return QueryCluster.COMPLEX_REFACTOR;
  }
  if (/\b(across files|multiple files|interaction between|dependency)\b/.test(promptLower)) {
    return QueryCluster.CROSS_FILE_REASONING;
  }
  if (/\b(error|fail|bug|stack trace|exception|traceback)\b/.test(promptLower)) {
    return QueryCluster.ERROR_DIAGNOSIS;
  }
  if (/\b(update plan|revise plan|modify plan|change approach)\b/.test(promptLower)) {
    return QueryCluster.PLAN_UPDATE;
  }
  if (/\b(rename|format|typo|spacing|indent)\b/.test(promptLower)) {
    return QueryCluster.SIMPLE_EDIT;
  }

  // 4. Default by task type
  if (task === LLMTask.PLANNER) return QueryCluster.CROSS_FILE_REASONING;
  if (task === LLMTask.PROGRAMMER) return QueryCluster.CODE_GENERATION;

  return QueryCluster.CODE_GENERATION; // safe default
}
```

#### Stage 2: Embedding-Based Classifier (future upgrade)

Replace the heuristic classifier with actual embeddings + cluster assignment:

```ts
export class EmbeddingClassifier {
  private centroids: Map<QueryCluster, number[]>;  // precomputed cluster centroids

  constructor(centroidsPath: string) {
    // Load precomputed centroids from JSON file
    this.centroids = loadCentroids(centroidsPath);
  }

  async classify(prompt: string): Promise<QueryCluster> {
    // 1. Embed the prompt (use a local model like all-MiniLM-L6-v2 or API)
    const embedding = await this.embed(prompt);
    // 2. Find nearest centroid via cosine similarity
    return this.nearestCluster(embedding);
  }
}
```

The embedding classifier is a drop-in replacement — same `QueryCluster` output, just more accurate. We build the centroids by:
1. Collecting prompts from real OpenSWE runs (or synthetic ones)
2. Embedding them
3. Running k-means with k = number of QueryCluster values
4. Saving centroids to a JSON file

#### Stage 3: Matrix Factorization Router (advanced upgrade)

Replace cosine-to-centroid with a **matrix factorization router** (RouteLLM-style) for capturing comparative model strengths:

1. Construct a query-model performance matrix from logged routing data
2. Augment training data with **synthetic preference labels** generated by an LLM-judge (e.g. "opus output was better than haiku output for this prompt")
3. Factorize the matrix to learn latent query features and model features
4. At routing time, score = dot product of query embedding × model embedding
5. Route to the cheapest model whose score exceeds a quality threshold

This approach excels at capturing **when** a weak model is sufficient vs. when a strong model is needed, which is the core routing decision.

---

### Phase 4: Budget Tracker

**Goal**: Real-time budget computation from `tokenData` state.

**New file**: `apps/open-swe/src/utils/runtime/budget-tracker.ts`

```ts
export interface BudgetConfig {
  tokenBudget?: number;            // max total tokens
  costBudget?: number;             // max total cost in USD
  degradationThresholds: number[]; // e.g. [0.6, 0.85]
  routingStrategy: "cluster-adaptive" | "fixed-tier" | "task-priority";
  fixedTier?: ModelTier;
}

export class BudgetTracker {
  /** Compute total cost from tokenData using per-model cost table */
  computeTotalCost(tokenData: ModelTokenData[]): number

  /** Compute total tokens consumed */
  computeTotalTokens(tokenData: ModelTokenData[]): number

  /** Budget utilization as 0.0 to 1.0 */
  getBudgetUtilization(tokenData: ModelTokenData[], config: BudgetConfig): number

  /** How many degradation steps based on utilization + thresholds */
  getDegradationLevel(utilization: number, thresholds: number[]): number

  /** Should we terminate the run? */
  isBudgetExhausted(tokenData: ModelTokenData[], config: BudgetConfig): boolean

  /** Estimate cost of next call at a given tier (for lookahead) */
  estimateCallCost(tier: ModelTier, estimatedInputTokens: number): number
}
```

---

### Phase 5: Budget Configuration Schema

**Goal**: Thread budget + routing parameters through the graph config.

**Modify**: `packages/shared/src/open-swe/types.ts`

Add to `GraphConfiguration`:

```ts
// ---- Runtime Budget Configuration ----

/** Maximum total token budget for the entire run. Default: unlimited */
tokenBudget: z.number().optional(),

/** Maximum dollar budget for the entire run. Default: unlimited */
costBudget: z.number().optional(),

/**
 * Budget thresholds that trigger model degradation.
 * At each threshold (% of budget consumed), the router tightens its tier selection.
 * Default: [0.6, 0.85]
 */
degradationThresholds: z.array(z.number()).optional(),

/**
 * Strategy for model routing.
 * - "cluster-adaptive": classify query → pick cheapest viable model for cluster, degrade as budget depletes (default)
 * - "fixed-tier": use a single tier for the whole run
 * - "task-priority": always use PREMIUM for PROGRAMMER, cluster-route others
 */
routingStrategy: z.enum(["cluster-adaptive", "fixed-tier", "task-priority"]).optional(),

/**
 * If routingStrategy is "fixed-tier", which tier to use.
 */
fixedTier: z.enum(["premium", "standard", "economy"]).optional(),

/**
 * Enable one-step cascade: if a routed model produces low-quality output,
 * automatically escalate to the next tier and retry.
 * Default: true
 */
enableCascade: z.boolean().optional(),
```

---

### Phase 6: Cluster-Aware Model Manager (Core)

**Goal**: Subclass `ModelManager` to intercept `loadModel()`, classify the query, and route to the optimal model for that cluster within budget.

**New file**: `apps/open-swe/src/utils/runtime/cluster-model-manager.ts`

```ts
export class ClusterAwareModelManager extends ModelManager {
  private budgetTracker: BudgetTracker;
  private queryClassifier: typeof classifyQuery; // heuristic or embedding-based
  private runtimeLogger: RuntimeLogger;

  async loadModel(graphConfig: GraphConfig, task: LLMTask) {
    const tokenData = graphConfig.configurable?.tokenData ?? [];
    const budgetConfig = this.extractBudgetConfig(graphConfig);

    // 1. Check termination
    if (this.budgetTracker.isBudgetExhausted(tokenData, budgetConfig)) {
      throw new BudgetExhaustedError(tokenData, budgetConfig);
    }

    // 2. Extract the prompt from the most recent messages in state
    const prompt = this.extractPromptContext(graphConfig);

    // 3. Classify the query into a cluster
    const cluster = this.queryClassifier(prompt, task);

    // 4. Determine the target tier based on cluster + budget
    const targetTier = this.resolveClusterTier(cluster, tokenData, budgetConfig);

    // 5. Override the model name
    const provider = this.getCurrentProvider(graphConfig, task);
    const tierConfig = MODEL_TIER_REGISTRY[targetTier];
    const overriddenModelName = `${provider}:${tierConfig.models[provider]}`;

    const originalModelName = graphConfig.configurable?.[`${task}ModelName`];
    if (graphConfig.configurable) {
      graphConfig.configurable[`${task}ModelName`] = overriddenModelName;
    }

    // 6. Log the routing decision
    this.runtimeLogger.logRouting({
      task,
      cluster,
      originalModel: originalModelName,
      routedModel: overriddenModelName,
      tier: targetTier,
      utilization: this.budgetTracker.getBudgetUtilization(tokenData, budgetConfig),
    });

    // 7. Delegate to parent
    return super.loadModel(graphConfig, task);
  }

  private resolveClusterTier(
    cluster: QueryCluster,
    tokenData: ModelTokenData[],
    config: BudgetConfig,
  ): ModelTier {
    const profile = CLUSTER_QUALITY_PROFILES[cluster];

    switch (config.routingStrategy) {
      case "fixed-tier":
        return config.fixedTier ?? ModelTier.STANDARD;

      case "task-priority":
        // For PROGRAMMER clusters, use preferred tier; others degrade
        if ([QueryCluster.CODE_GENERATION, QueryCluster.COMPLEX_REFACTOR,
             QueryCluster.CROSS_FILE_REASONING].includes(cluster)) {
          return profile.preferredTier;
        }
        return this.getAdaptiveClusterTier(profile, tokenData, config);

      case "cluster-adaptive":
      default:
        return this.getAdaptiveClusterTier(profile, tokenData, config);
    }
  }

  private getAdaptiveClusterTier(
    profile: ClusterQualityProfile,
    tokenData: ModelTokenData[],
    config: BudgetConfig,
  ): ModelTier {
    const utilization = this.budgetTracker.getBudgetUtilization(tokenData, config);
    const degradationLevel = this.budgetTracker.getDegradationLevel(
      utilization, config.degradationThresholds
    );

    const tiers = [ModelTier.PREMIUM, ModelTier.STANDARD, ModelTier.ECONOMY];
    const preferredIdx = tiers.indexOf(profile.preferredTier);
    const minIdx = tiers.indexOf(profile.minViableTier);

    // Start from preferred, degrade by degradationLevel, but never below minViable
    const targetIdx = Math.min(preferredIdx + degradationLevel, minIdx);
    return tiers[targetIdx];
  }
}
```

#### How the routing decision works (example)

Given budget at 70% utilization (past first threshold):

| Incoming Query | Cluster | Preferred Tier | Degradation | Min Viable | → Selected Tier |
|---|---|---|---|---|---|
| "List files in src/" | FILE_EXPLORATION | ECONOMY | +1 | ECONOMY | ECONOMY |
| "Write a unit test for auth" | CODE_GENERATION | PREMIUM | +1 | STANDARD | STANDARD |
| "Refactor payment module" | COMPLEX_REFACTOR | PREMIUM | +1 | PREMIUM | PREMIUM (can't degrade) |
| "Summarize last 10 actions" | SUMMARIZATION | ECONOMY | +1 | ECONOMY | ECONOMY |
| "Diagnose this test failure" | ERROR_DIAGNOSIS | PREMIUM | +1 | STANDARD | STANDARD |

Notice: COMPLEX_REFACTOR stays at PREMIUM even under budget pressure because its `minViableTier` is PREMIUM — degrading it would produce bad output and waste tokens on retries.

---

### Phase 7: One-Step Cascade (FrugalGPT-inspired)

**Goal**: When a routed model produces low-quality output, automatically escalate to the next tier and retry — acting as a safety net for misclassified queries or edge cases where the cheaper model isn't sufficient.

**New file**: `apps/open-swe/src/utils/runtime/cascade.ts`

#### Quality Gate: Determining "Bad Output"

Unlike FrugalGPT's general-purpose scoring function, we can use **structural quality signals** specific to coding agent outputs:

```ts
export interface QualityCheckResult {
  passed: boolean;
  reason?: string;
}

export function checkOutputQuality(
  response: AIMessageChunk,
  task: LLMTask,
): QualityCheckResult {
  // 1. Empty or near-empty response
  const content = getMessageContentString(response.content);
  if (!content && (!response.tool_calls || response.tool_calls.length === 0)) {
    return { passed: false, reason: "empty_response" };
  }

  // 2. Malformed tool calls (name present but args missing/invalid)
  if (response.tool_calls?.some(tc => !tc.name || tc.args === undefined)) {
    return { passed: false, reason: "malformed_tool_call" };
  }

  // 3. Refusal / "I can't do that" patterns
  const refusalPatterns = /\b(i cannot|i can't|i'm unable|i am unable|as an ai)\b/i;
  if (refusalPatterns.test(content) && task === LLMTask.PROGRAMMER) {
    return { passed: false, reason: "model_refusal" };
  }

  // 4. Truncated output (hit token limit without completing)
  if (response.response_metadata?.finish_reason === "length") {
    return { passed: false, reason: "truncated_output" };
  }

  return { passed: true };
}
```

#### Cascade Integration in FallbackRunnable

**Modify**: `apps/open-swe/src/utils/runtime-fallback.ts`

Extend `FallbackRunnable.invoke()` to add a post-invocation quality check. If it fails and cascade is enabled, escalate to the next tier:

```ts
async invoke(input, options?) {
  // ... existing provider fallback loop ...

  const result = await runnableToUse.invoke(providerSpecificMessages, options);
  this.modelManager.recordSuccess(modelKey);

  // NEW: Quality cascade check
  if (this.cascadeEnabled) {
    const qualityCheck = checkOutputQuality(result, this.task);
    if (!qualityCheck.passed) {
      const currentTier = this.getCurrentTier();
      const nextTier = this.getNextHigherTier(currentTier);

      if (nextTier && this.canAffordEscalation(nextTier)) {
        this.runtimeLogger.logCascadeEscalation({
          task: this.task,
          fromTier: currentTier,
          toTier: nextTier,
          reason: qualityCheck.reason,
        });

        // Retry with higher tier model
        return this.retryWithTier(nextTier, input, options);
      }
    }
  }

  return result;
}
```

#### Cascade Rules

| Quality Failure | Action | Budget Check |
|---|---|---|
| `empty_response` | Escalate one tier | Yes — only if budget allows |
| `malformed_tool_call` | Escalate one tier | Yes |
| `model_refusal` | Escalate one tier | Yes |
| `truncated_output` | Escalate one tier (with higher maxTokens) | Yes |
| Already at PREMIUM | Do not escalate, return as-is | N/A |
| Budget exhausted | Do not escalate, return as-is | N/A |

**Key constraint**: The cascade only goes **one step up** (ECONOMY → STANDARD, or STANDARD → PREMIUM). No cascading from ECONOMY → PREMIUM in one jump. This bounds the worst-case cost per query to 2× the original tier's cost.

---

### Phase 8: Injection Point — Wire It In

**Goal**: Replace the default `ModelManager` singleton with `ClusterAwareModelManager`.

**Modify**: `apps/open-swe/src/utils/llms/model-manager.ts`

```ts
import { ClusterAwareModelManager } from "../runtime/cluster-model-manager.js";

export function getModelManager(
  config?: Partial<ModelManagerConfig>,
): ModelManager {
  if (!globalModelManager) {
    const useBudgetRuntime = process.env.ENABLE_BUDGET_RUNTIME === "true";
    globalModelManager = useBudgetRuntime
      ? new ClusterAwareModelManager(config)
      : new ModelManager(config);
  }
  return globalModelManager;
}
```

Feature-flagged via `ENABLE_BUDGET_RUNTIME=true`.

---

### Phase 9: Logging, Observability & Evaluation Metrics

**New file**: `apps/open-swe/src/utils/runtime/runtime-logger.ts`

```ts
export interface RoutingLogEntry {
  timestamp: number;
  event: "model_routed" | "tier_degraded" | "budget_exhausted"
       | "call_completed" | "cascade_escalated";
  task: LLMTask;
  cluster: QueryCluster;
  tier: ModelTier;
  modelName: string;
  budgetUtilization: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  remainingBudget: number | null;
  // Cascade-specific
  cascadeReason?: string;
  escalatedFrom?: ModelTier;
}

export class RuntimeLogger {
  private entries: RoutingLogEntry[] = [];

  logRouting(entry: Partial<RoutingLogEntry>): void
  logDegradation(fromTier: ModelTier, toTier: ModelTier, trigger: number): void
  logBudgetExhausted(tokenData: ModelTokenData[], config: BudgetConfig): void
  logCallCompleted(task: LLMTask, tokensUsed: number): void
  logCascadeEscalation(details: { task: LLMTask; fromTier: ModelTier; toTier: ModelTier; reason: string }): void

  /** Export all entries for analysis */
  getEntries(): RoutingLogEntry[]

  /** Summary stats: cost per cluster, calls per tier, cascade rate, etc. */
  getSummary(): RoutingSummary

  /** Advanced evaluation metrics */
  getEvaluationMetrics(): EvaluationMetrics
}
```

#### Evaluation Metrics: APGR and CPT

Track data to calculate two key metrics for proving router effectiveness:

```ts
export interface EvaluationMetrics {
  /**
   * Average Performance Gap Recovered (APGR)
   *
   * Measures how much of the gap between random routing and oracle (perfect) routing
   * our router closes.
   *
   * APGR = (routerScore - randomBaselineScore) / (oracleScore - randomBaselineScore)
   *
   * - APGR = 1.0: our router matches the oracle (always picks the best model)
   * - APGR = 0.0: our router is no better than random
   * - APGR < 0.0: our router is worse than random (something is very wrong)
   *
   * To compute: log the "would-have-been" random choice alongside actual choice,
   * and track task success rates per routing decision.
   */
  apgr: number;

  /**
   * Call-Performance Threshold (CPT)
   *
   * The minimum number of LLM calls before the router outperforms the strategy
   * of "always use the most expensive model." Measures how quickly the router
   * pays back its overhead through cost savings.
   *
   * Lower CPT = faster payback = router proves its value sooner.
   *
   * To compute: compare cumulative (cost, quality) curves of router vs. always-PREMIUM.
   */
  cpt: number;

  /** Supporting data */
  totalCalls: number;
  callsByTier: Record<ModelTier, number>;
  callsByCluster: Record<QueryCluster, number>;
  cascadeRate: number;              // % of calls that triggered cascade escalation
  cascadeSuccessRate: number;       // % of escalations that improved output quality
  costSavingsVsAlwaysPremium: number; // $ saved compared to always using PREMIUM
  qualityScoreVsAlwaysPremium: number; // quality delta (ideally ≈ 0)
}
```

**How to collect APGR data** without running a separate oracle:
- For each routing decision, log: `{ cluster, selectedTier, randomTier: randomChoice([P,S,E]), taskSucceeded: boolean }`
- `taskSucceeded` is determined post-hoc: did the tool call execute without error? Did the code compile? Did tests pass?
- Aggregate over all calls to compute APGR

**How to collect CPT data**:
- Maintain a running cumulative cost curve for the router
- Maintain a shadow cumulative cost curve assuming always-PREMIUM
- CPT = the call index where `cumulativeCost_router < cumulativeCost_premium` while `quality_router ≈ quality_premium`

---

### Phase 10: Error Handling — Graceful Budget Exhaustion

**New file**: `apps/open-swe/src/utils/runtime/errors.ts`

```ts
export class BudgetExhaustedError extends Error {
  constructor(
    public tokenData: ModelTokenData[],
    public budgetConfig: BudgetConfig,
  ) {
    const totalCost = computeTotalCost(tokenData);
    super(`Budget exhausted: $${totalCost.toFixed(4)} spent of $${budgetConfig.costBudget} budget`);
  }
}
```

**Modify**: `apps/open-swe/src/graphs/programmer/index.ts`

Catch `BudgetExhaustedError` in the generate-action → take-action flow and route to `generate-conclusion` with a budget-specific summary message.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `apps/open-swe/src/utils/runtime/model-tiers.ts` | **CREATE** | Capacity tier definitions, cost table |
| `apps/open-swe/src/utils/runtime/query-clusters.ts` | **CREATE** | Cluster enum, quality profiles (heuristic + vectorized interface) |
| `apps/open-swe/src/utils/runtime/query-classifier.ts` | **CREATE** | Stage 1 heuristic + Stage 2 embedding + Stage 3 matrix factorization interfaces |
| `apps/open-swe/src/utils/runtime/budget-tracker.ts` | **CREATE** | Real-time budget computation |
| `apps/open-swe/src/utils/runtime/cluster-model-manager.ts` | **CREATE** | Core: ClusterAwareModelManager subclass |
| `apps/open-swe/src/utils/runtime/cascade.ts` | **CREATE** | Quality gate + one-step cascade logic |
| `apps/open-swe/src/utils/runtime/runtime-logger.ts` | **CREATE** | Structured logging + APGR/CPT metrics |
| `apps/open-swe/src/utils/runtime/errors.ts` | **CREATE** | BudgetExhaustedError |
| `apps/open-swe/src/utils/runtime/index.ts` | **CREATE** | Barrel export |
| `packages/shared/src/open-swe/types.ts` | **MODIFY** | Add budget/routing/cascade fields to GraphConfiguration |
| `apps/open-swe/src/utils/llms/model-manager.ts` | **MODIFY** | Swap singleton (feature-flagged) |
| `apps/open-swe/src/utils/runtime-fallback.ts` | **MODIFY** | Add quality gate + cascade escalation to invoke() |
| `apps/open-swe/src/graphs/programmer/index.ts` | **MODIFY** | Handle BudgetExhaustedError |
| `packages/shared/src/caching.ts` | **MODIFY** | Per-model cost calculation |
| `apps/open-swe/.env.example` | **MODIFY** | Add ENABLE_BUDGET_RUNTIME |

---

## Implementation Order

```
Phase 1:   model-tiers.ts            (pure data, no deps)
Phase 2:   query-clusters.ts         (pure data, no deps)
Phase 3:   query-classifier.ts       (depends on Phase 2)
Phase 4:   budget-tracker.ts         (depends on Phase 1)
Phase 5:   types.ts modifications    (schema only)
Phase 6:   cluster-model-manager.ts  (depends on 1-5, core integration)
Phase 7:   cascade.ts + fallback mod (depends on Phase 1, can parallel with 6)
Phase 8:   model-manager.ts mod      (depends on Phase 6, wiring)
Phase 9:   runtime-logger.ts         (can parallel with Phase 6-7)
Phase 10:  error handling            (depends on Phase 6, 8)
```

Phases 1-4 are pure logic, fully unit-testable without running OpenSWE or spending API credits.
Phase 6 is the integration core.
Phase 7 (cascade) can be developed in parallel with Phase 6.
Phases 9-10 are observability and resilience polish.

---

## Testing Strategy

All tests are unit/mock-based (no API credits):

1. **Query classifier tests**: Given sample prompts + task types, verify correct cluster assignment
2. **Budget tracker tests**: Mock tokenData arrays → verify cost computation, utilization %, degradation level
3. **Cluster routing tests**: For each cluster × utilization level × strategy, verify the correct tier is selected
4. **Cascade quality gate tests**: Given mock AIMessageChunk responses, verify correct pass/fail decisions and escalation behavior
5. **ClusterAwareModelManager tests**: Mock `super.loadModel()`, verify correct model override
6. **APGR/CPT metric tests**: Given mock log entries, verify correct metric computation
7. **End-to-end mock test**: Simulate a full agent run's worth of loadModel calls with a budget, verify degradation + cascade behavior

---

## Example: Full Agent Run with $0.50 Budget

### Setup
- Budget: $0.50
- Strategy: cluster-adaptive
- Thresholds: [0.6, 0.85]
- Cascade: enabled

### Run trace

| Step | Query | Cluster | Util. | Deg. | Tier | Model | Cascade? |
|------|-------|---------|-------|------|------|-------|----------|
| 1 | "Read repo structure" | FILE_EXPLORATION | 0% | 0 | ECONOMY | haiku | — |
| 2 | "Generate impl plan" | CROSS_FILE_REASONING | 2% | 0 | PREMIUM | opus | — |
| 3 | "Write auth middleware" | CODE_GENERATION | 15% | 0 | PREMIUM | opus | — |
| 4 | "Run test suite" | COMMAND_EXECUTION | 30% | 0 | ECONOMY | haiku | — |
| 5 | "Fix failing test" | ERROR_DIAGNOSIS | 32% | 0 | PREMIUM | opus | — |
| 6 | "Write second endpoint" | CODE_GENERATION | 50% | 0 | PREMIUM | opus | — |
| 7 | "Summarize progress" | SUMMARIZATION | 58% | 0 | ECONOMY | haiku | — |
| 8 | "Refactor error handling" | COMPLEX_REFACTOR | 62% | 1 | PREMIUM | opus | — |
| 9 | "Update test" | CODE_GENERATION | 75% | 1 | STANDARD | sonnet | — |
| 10 | "Small rename" | SIMPLE_EDIT | 78% | 1 | ECONOMY | haiku | empty → STANDARD ✓ |
| 11 | "Review changes" | CODE_REVIEW | 82% | 1 | STANDARD | sonnet | — |
| 12 | "Final summary" | SUMMARIZATION | 87% | 2 | ECONOMY | haiku | — |
| 13 | "Open PR" | ROUTING_CLASSIFICATION | 89% | 2 | ECONOMY | haiku | — |

**Step 10**: Haiku produced an empty response for a rename task (misclassified as too simple). Cascade caught it and escalated to sonnet, which succeeded. Cost: ~2× a haiku call, still cheaper than if it had been routed to opus originally.

**Result**: $0.46 spent. 1 cascade escalation out of 13 calls (7.7% cascade rate). Complex tasks stayed on opus. Budget preserved.

---

## Upgrade Roadmap

| Stage | Classifier | Cluster Profiles | Description |
|-------|-----------|-----------------|-------------|
| **Stage 1 (MVP)** | Heuristic (keyword/tool-call) | Static min/preferred tiers | Ships immediately, no deps |
| **Stage 2** | Embedding + k-means centroids | Vectorized per-cluster error (UniRoute) | Requires collected prompts + embedding model |
| **Stage 3** | Matrix factorization (RouteLLM) | Learned query×model scores | Requires preference data (synthetic via LLM-judge) |

Each stage is a drop-in replacement — same `QueryCluster` output interface, increasingly accurate routing decisions. The RuntimeLogger collects the data needed to train each successive stage.
