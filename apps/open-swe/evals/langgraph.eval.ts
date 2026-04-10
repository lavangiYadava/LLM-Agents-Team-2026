// Run evals over the development Open SWE dataset

import { v4 as uuidv4 } from "uuid";
import * as ls from "langsmith/vitest";
import { formatInputs } from "./prompts.js";
import { createLogger, LogLevel } from "../src/utils/logger.js";
import { evaluator } from "./evaluator.js";
import { MANAGER_GRAPH_ID, GITHUB_PAT } from "@openswe/shared/constants";
import { createLangGraphClient } from "../src/utils/langgraph-client.js";
import { encryptSecret } from "@openswe/shared/crypto";
import { ManagerGraphState } from "@openswe/shared/open-swe/manager/types";
import { PlannerGraphState } from "@openswe/shared/open-swe/planner/types";
import { GraphState } from "@openswe/shared/open-swe/types";
import { withRetry } from "./utils/retry.js";

const logger = createLogger(LogLevel.DEBUG, "Evaluator");

const DATASET_NAME = process.env.DATASET_NAME || "";
// const RUN_NAME = `${DATASET_NAME}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

// async function loadDataset(): Promise<Example[]> {
//   const client = new LangSmithClient();
//   const datasetStream = client.listExamples({ datasetName: DATASET_NAME });
//   let examples: Example[] = [];
//   for await (const example of datasetStream) {
//     examples.push(example);
//   }
//   logger.info(
//     `Loaded ${examples.length} examples from dataset "${DATASET_NAME}"`,
//   );
//   return examples;
// }

// const DATASET = await loadDataset().then((examples) =>
//   examples.map(example => ({
//     inputs: example.inputs as OpenSWEInput,
//   })),
// );

const DATASET = [
  {
    inputs: {
      repo: "mai-sandbox/open-swe_content_team_eval",
      branch: "main",
      user_input: `I have implemented a multi-agent content creation system using LangGraph that orchestrates collaboration between specialized agents. The system is experiencing multiple runtime errors and workflow failures that prevent proper execution.

System Architecture
The application implements a three-agent architecture:

Research Agent: Utilizes web search tools to gather information on specified topics
Writer Agent: Creates content based on research findings with creative temperature settings
Reviewer Agent: Provides feedback using fact-checking tools and determines revision needs

Expected Workflow
User Request → Research Agent → Writer Agent → Reviewer Agent → [Revision Loop if needed] → Final Content

Current Issues

Runtime Errors: Application fails to start with import and graph compilation errors
Agent Handoff Failures: Agents are not properly transferring control and context
Tool Integration Problems: Tool calling mechanisms are not functioning correctly
State Management Issues: Shared state is not being updated correctly across agent transitions
Routing Logic Failures: Conditional edges and workflow routing are broken`,
    },
  },
  {
    inputs: {
      repo: "Pepps233/open-swe_type_annotations_eval",
      branch: "main",
      user_input: `The Python utility module \`utils/math_utils.py\` has several functions that are missing
type annotations, causing mypy to report errors. The functions \`add\`, \`multiply\`, and
\`compute_average\` are all missing parameter and return type hints. Please add proper
type annotations so that mypy passes with no errors. Do not change the function logic.`,
    },
  },
  {
    inputs: {
      repo: "Pepps233/open-swe_ruff_violations_eval",
      branch: "main",
      user_input: `The file \`src/processor.py\` has several code quality issues that ruff reports as errors.
There are unused imports at the top of the file (\`os\`, \`sys\`, \`json\`) and a variable
\`result\` is assigned but never used inside the \`process_data\` function. Please fix all
ruff violations so that \`ruff check .\` exits with code 0.`,
    },
  },
  {
    inputs: {
      repo: "Pepps233/open-swe_multifile_types_eval",
      branch: "main",
      user_input: `Our data pipeline has type errors that mypy catches across two files. In
\`pipeline/loader.py\`, the function \`load_config\` is annotated to return \`dict[str, str]\`
but can return \`None\` when the file path is empty. In \`pipeline/transformer.py\`, the
function \`transform\` calls \`load_config()\` and passes the result to \`process_record\`
which expects \`dict[str, str]\`, but there is no None guard. Fix the type errors so mypy
reports no errors or warnings. You may update type signatures and add None checks as
needed, but do not change the overall program logic.`,
    },
  },
  {
    inputs: {
      repo: "Pepps233/open-swe_stub_impl_eval",
      branch: "main",
      user_input: `The module \`services/validator.py\` has two functions that are currently stubs and raise
NotImplementedError: \`validate_email(email: str) -> bool\` and \`validate_phone(phone: str)
-> bool\`. The file \`tests/test_validator.py\` documents the expected behavior with
examples. Please implement both functions using only the Python standard library so the
code passes both ruff and mypy checks cleanly.`,
    },
  },
  {
    inputs: {
      repo: "Pepps233/open-swe_dataclass_eval",
      branch: "main",
      user_input: `The file \`models/event.py\` defines a Python dataclass \`Event\` that has several issues:
(1) The \`__post_init__\` method references \`self.timestamp\` but the field is named
\`created_at\`. (2) The subclass \`TimedEvent\` inherits from \`object\` instead of \`Event\`,
so it is missing the parent fields. Fix all issues so that ruff and mypy both pass cleanly.`,
    },
  },
];

logger.info(`Starting evals over ${DATASET.length} examples...`);

//const LANGGRAPH_URL = process.env.LANGGRAPH_URL || "http://localhost:2024";

ls.describe(DATASET_NAME, () => {
  ls.test.each(DATASET)(
    "Can resolve issue",
    async ({ inputs }) => {
      logger.info("Starting agent run", {
        inputs,
      });

      const encryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
      const githubPat = process.env.GITHUB_PAT;

      if (!encryptionKey || !githubPat) {
        throw new Error(
          "SECRETS_ENCRYPTION_KEY and GITHUB_PAT environment variables are required",
        );
      }

      const encryptedGitHubToken = encryptSecret(githubPat, encryptionKey);

      const lgClient = createLangGraphClient({
        includeApiKey: true,
        defaultHeaders: { [GITHUB_PAT]: encryptedGitHubToken },
      });

      const input = await formatInputs(inputs);

      const threadId = uuidv4();
      logger.info("Starting agent run", {
        thread_id: threadId,
        problem: inputs.user_input,
        repo: inputs.repo,
      });

      // Run the agent with user input
      let managerRun;
      try {
        managerRun = await withRetry(() =>
          lgClient.runs.wait(threadId, MANAGER_GRAPH_ID, {
            input,
            config: {
              recursion_limit: 250,
            },
            ifNotExists: "create",
          }),
        );
      } catch (error) {
        logger.error("Error in manager run", {
          thread_id: threadId,
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  stack: error.stack,
                  name: error.name,
                  cause: error.cause,
                }
              : error,
        });
        return; // instead of skipping, we should award 0 points
      }

      const managerState = managerRun as unknown as ManagerGraphState;
      const plannerSession = managerState?.plannerSession;

      if (!plannerSession) {
        logger.info("Agent did not create a planner session", {
          thread_id: threadId,
        });
        return; // instead of skipping, we should award 0 points
      }

      let plannerRun;
      try {
        plannerRun = await withRetry(() =>
          lgClient.runs.join(plannerSession.threadId, plannerSession.runId),
        );
      } catch (error) {
        logger.error("Error joining planner run", {
          thread_id: threadId,
          plannerSession,
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  stack: error.stack,
                  name: error.name,
                  cause: error.cause,
                }
              : error,
        });
        return; // instead of skipping, we should award 0 points
      }

      // Type-safe access to planner run state
      const plannerState = plannerRun as unknown as PlannerGraphState;
      const programmerSession = plannerState?.programmerSession;

      if (!programmerSession) {
        logger.info("Agent did not create a programmer session", {
          thread_id: threadId,
        });
        return; // instead of skipping, we should award 0 points
      }

      let programmerRun;
      try {
        programmerRun = await withRetry(() =>
          lgClient.runs.join(
            programmerSession.threadId,
            programmerSession.runId,
          ),
        );
      } catch (error) {
        logger.error("Error joining programmer run", {
          thread_id: threadId,
          programmerSession,
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  stack: error.stack,
                  name: error.name,
                  cause: error.cause,
                }
              : error,
        });
        return; // instead of skipping, we should award 0 points
      }

      const programmerState = programmerRun as unknown as GraphState;
      const branchName = programmerState?.branchName;

      if (!branchName) {
        logger.info("Agent did not create a branch", {
          thread_id: threadId,
        });
        return; // instead of skipping, we should award 0 points
      }

      logger.info("Agent completed. Created branch:", {
        branchName: branchName,
      });

      // Aggregate tokenData from programmer state
      const tokenData = programmerState?.tokenData ?? [];

      // Evaluation
      const wrappedEvaluator = ls.wrapEvaluator(evaluator);
      const evalResult = await wrappedEvaluator({
        openSWEInputs: inputs,
        output: {
          branchName,
          tokenData,
          targetRepository: {
            owner: inputs.repo.split("/")[0],
            repo: inputs.repo.split("/")[1],
          },
        },
      });

      logger.info("Evaluation completed.", {
        thread_id: threadId,
        evalResult,
      });
    },
    7200_000,
  );
});
