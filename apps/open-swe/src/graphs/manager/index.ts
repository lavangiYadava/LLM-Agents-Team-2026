import { END, START, StateGraph } from "@langchain/langgraph";
import { GraphConfiguration } from "@openswe/shared/open-swe/types";
import { ManagerGraphStateObj } from "@openswe/shared/open-swe/manager/types";
import {
  initializeGithubIssue,
  classifyMessage,
  startPlanner,
  createNewSession,
} from "./nodes/index.js";
import type { NodeName } from "@openswe/shared/telemetry";
import { collectors, timed } from "../../utils/telemetry-wrapper.js";

void collectors;

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
