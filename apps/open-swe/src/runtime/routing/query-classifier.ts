import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { QueryCluster } from "./query-clusters.js";

export interface ToolCallHint {
  name: string;
  args?: Record<string, unknown>;
}

// Tool name patterns that indicate file exploration
const FILE_EXPLORATION_TOOLS = new Set([
  "list_directory",
  "read_file",
  "find_files",
  "glob",
  "search_files",
  "get_file_tree",
  "view_file",
]);

// Tool name patterns that indicate shell/command execution
const COMMAND_EXECUTION_TOOLS = new Set([
  "run_command",
  "execute_command",
  "shell",
  "bash",
  "terminal",
  "run_terminal_cmd",
]);

// Keyword patterns for classification (matched against lowercased prompt)
const REFACTOR_PATTERNS = [
  /\brefactor\b/,
  /\brestructure\b/,
  /\breorganize\b/,
  /\bextract\s+(method|function|class|component|module)\b/,
  /\bmove\s+(method|function|class|component)\b/,
];

const ERROR_PATTERNS = [
  /\berror\b/,
  /\bfail(ed|ure|ing)?\b/,
  /\bbug\b/,
  /\bfix\b/,
  /\bcrash(ed|ing|es)?\b/,
  /\bexception\b/,
  /\btraceback\b/,
  /\bdiagnos[ei]/,
  /\bdebug\b/,
];

const SIMPLE_EDIT_PATTERNS = [
  /\brename\b/,
  /\bupdate\s+(the\s+)?(name|label|title|text|string|value|comment)\b/,
  /\bchange\s+(the\s+)?(name|label|title|text|string|value|comment)\b/,
  /\badd\s+(a\s+)?(comment|docstring|type\s*hint|import)\b/,
  /\bremove\s+(the\s+)?(unused|dead|old)\b/,
  /\btypo\b/,
];

const CROSS_FILE_PATTERNS = [
  /\bacross\s+(multiple\s+)?files\b/,
  /\bmultiple\s+files\b/,
  /\bdependenc(y|ies)\b/,
  /\bimport\s+graph\b/,
  /\bcall\s*(graph|chain|tree)\b/,
  /\barchitecture\b/,
];

/**
 * Heuristic query classifier.
 *
 * Classification priority:
 * 1. Task-based shortcuts (ROUTER, SUMMARIZER, REVIEWER)
 * 2. Tool-call analysis
 * 3. Keyword/pattern matching on prompt
 * 4. Default fallback by task type
 */
export function classifyQuery(
  prompt: string,
  task: LLMTask,
  lastToolCalls?: ToolCallHint[],
): QueryCluster {
  // 1. Task-based shortcuts
  const shortcut = taskShortcut(task);
  if (shortcut !== undefined) return shortcut;

  // 2. Tool-call-based classification
  if (lastToolCalls && lastToolCalls.length > 0) {
    const toolCluster = classifyByToolCalls(lastToolCalls);
    if (toolCluster !== undefined) return toolCluster;
  }

  // 3. Keyword/pattern matching
  const keywordCluster = classifyByKeywords(prompt);
  if (keywordCluster !== undefined) return keywordCluster;

  // 4. Default by task type
  return defaultForTask(task);
}

function taskShortcut(task: LLMTask): QueryCluster | undefined {
  switch (task) {
    case LLMTask.ROUTER:
      return QueryCluster.ROUTING_CLASSIFICATION;
    case LLMTask.SUMMARIZER:
      return QueryCluster.SUMMARIZATION;
    case LLMTask.REVIEWER:
      return QueryCluster.CODE_REVIEW;
    default:
      return undefined;
  }
}

function classifyByToolCalls(
  toolCalls: ToolCallHint[],
): QueryCluster | undefined {
  let hasFileOps = false;
  let hasCommandOps = false;

  for (const tc of toolCalls) {
    const name = tc.name.toLowerCase();
    if (FILE_EXPLORATION_TOOLS.has(name)) hasFileOps = true;
    if (COMMAND_EXECUTION_TOOLS.has(name)) hasCommandOps = true;
  }

  // Command execution takes priority — it may include file reads as context
  if (hasCommandOps) return QueryCluster.COMMAND_EXECUTION;
  if (hasFileOps) return QueryCluster.FILE_EXPLORATION;

  return undefined;
}

function classifyByKeywords(prompt: string): QueryCluster | undefined {
  const lower = prompt.toLowerCase();

  // Order matters: check more specific patterns first
  if (REFACTOR_PATTERNS.some((p) => p.test(lower))) {
    return QueryCluster.COMPLEX_REFACTOR;
  }
  if (CROSS_FILE_PATTERNS.some((p) => p.test(lower))) {
    return QueryCluster.CROSS_FILE_REASONING;
  }
  if (ERROR_PATTERNS.some((p) => p.test(lower))) {
    return QueryCluster.ERROR_DIAGNOSIS;
  }
  if (SIMPLE_EDIT_PATTERNS.some((p) => p.test(lower))) {
    return QueryCluster.SIMPLE_EDIT;
  }

  return undefined;
}

function defaultForTask(task: LLMTask): QueryCluster {
  switch (task) {
    case LLMTask.PLANNER:
      return QueryCluster.CROSS_FILE_REASONING;
    case LLMTask.PROGRAMMER:
      return QueryCluster.CODE_GENERATION;
    case LLMTask.REVIEWER:
      return QueryCluster.CODE_REVIEW;
    case LLMTask.ROUTER:
      return QueryCluster.ROUTING_CLASSIFICATION;
    case LLMTask.SUMMARIZER:
      return QueryCluster.SUMMARIZATION;
  }
}
