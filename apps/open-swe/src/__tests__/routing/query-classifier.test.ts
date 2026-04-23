import { describe, expect, it } from "@jest/globals";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { classifyQuery } from "../../runtime/routing/query-classifier.js";
import { QueryCluster } from "../../runtime/routing/query-clusters.js";
import type { ToolCallHint } from "../../runtime/routing/query-classifier.js";

describe("classifyQuery", () => {
  describe("task-based shortcuts", () => {
    it("ROUTER task → ROUTING_CLASSIFICATION", () => {
      expect(classifyQuery("anything", LLMTask.ROUTER)).toBe(
        QueryCluster.ROUTING_CLASSIFICATION,
      );
    });

    it("SUMMARIZER task → SUMMARIZATION", () => {
      expect(classifyQuery("anything", LLMTask.SUMMARIZER)).toBe(
        QueryCluster.SUMMARIZATION,
      );
    });

    it("REVIEWER task → CODE_REVIEW", () => {
      expect(classifyQuery("review this code", LLMTask.REVIEWER)).toBe(
        QueryCluster.CODE_REVIEW,
      );
    });
  });

  describe("tool-call-based classification", () => {
    it("file ops → FILE_EXPLORATION", () => {
      const toolCalls: ToolCallHint[] = [{ name: "read_file" }];
      expect(classifyQuery("", LLMTask.PROGRAMMER, toolCalls)).toBe(
        QueryCluster.FILE_EXPLORATION,
      );
    });

    it("shell tools → COMMAND_EXECUTION", () => {
      const toolCalls: ToolCallHint[] = [{ name: "run_command" }];
      expect(classifyQuery("", LLMTask.PROGRAMMER, toolCalls)).toBe(
        QueryCluster.COMMAND_EXECUTION,
      );
    });

    it("command tools take priority over file tools when mixed", () => {
      const toolCalls: ToolCallHint[] = [
        { name: "read_file" },
        { name: "run_command" },
      ];
      expect(classifyQuery("", LLMTask.PROGRAMMER, toolCalls)).toBe(
        QueryCluster.COMMAND_EXECUTION,
      );
    });

    it("multiple file ops → FILE_EXPLORATION", () => {
      const toolCalls: ToolCallHint[] = [
        { name: "list_directory" },
        { name: "find_files" },
      ];
      expect(classifyQuery("", LLMTask.PROGRAMMER, toolCalls)).toBe(
        QueryCluster.FILE_EXPLORATION,
      );
    });
  });

  describe("keyword-based classification", () => {
    it("refactor → COMPLEX_REFACTOR", () => {
      expect(
        classifyQuery(
          "Refactor the authentication module",
          LLMTask.PROGRAMMER,
        ),
      ).toBe(QueryCluster.COMPLEX_REFACTOR);
    });

    it("restructure → COMPLEX_REFACTOR", () => {
      expect(
        classifyQuery("Restructure the project layout", LLMTask.PROGRAMMER),
      ).toBe(QueryCluster.COMPLEX_REFACTOR);
    });

    it("extract method → COMPLEX_REFACTOR", () => {
      expect(
        classifyQuery(
          "Extract method from this function",
          LLMTask.PROGRAMMER,
        ),
      ).toBe(QueryCluster.COMPLEX_REFACTOR);
    });

    it("error/fix → ERROR_DIAGNOSIS", () => {
      expect(
        classifyQuery("Fix the TypeError in utils.ts", LLMTask.PROGRAMMER),
      ).toBe(QueryCluster.ERROR_DIAGNOSIS);
    });

    it("debug → ERROR_DIAGNOSIS", () => {
      expect(
        classifyQuery("Debug the failing test", LLMTask.PROGRAMMER),
      ).toBe(QueryCluster.ERROR_DIAGNOSIS);
    });

    it("bug → ERROR_DIAGNOSIS", () => {
      expect(
        classifyQuery("There is a bug in the login flow", LLMTask.PROGRAMMER),
      ).toBe(QueryCluster.ERROR_DIAGNOSIS);
    });

    it("rename → SIMPLE_EDIT", () => {
      expect(
        classifyQuery("Rename the variable to camelCase", LLMTask.PROGRAMMER),
      ).toBe(QueryCluster.SIMPLE_EDIT);
    });

    it("typo → SIMPLE_EDIT", () => {
      expect(
        classifyQuery("There is a typo in the readme", LLMTask.PROGRAMMER),
      ).toBe(QueryCluster.SIMPLE_EDIT);
    });

    it("across multiple files → CROSS_FILE_REASONING", () => {
      expect(
        classifyQuery(
          "Update the interface across multiple files",
          LLMTask.PROGRAMMER,
        ),
      ).toBe(QueryCluster.CROSS_FILE_REASONING);
    });

    it("dependencies → CROSS_FILE_REASONING", () => {
      expect(
        classifyQuery(
          "Check the dependency graph for cycles",
          LLMTask.PROGRAMMER,
        ),
      ).toBe(QueryCluster.CROSS_FILE_REASONING);
    });
  });

  describe("default fallbacks per task", () => {
    it("PLANNER defaults to CROSS_FILE_REASONING", () => {
      expect(
        classifyQuery("Plan the next implementation step", LLMTask.PLANNER),
      ).toBe(QueryCluster.CROSS_FILE_REASONING);
    });

    it("PROGRAMMER defaults to CODE_GENERATION", () => {
      expect(
        classifyQuery("Write a new utility function", LLMTask.PROGRAMMER),
      ).toBe(QueryCluster.CODE_GENERATION);
    });
  });

  describe("edge cases", () => {
    it("empty prompt with PROGRAMMER task → CODE_GENERATION", () => {
      expect(classifyQuery("", LLMTask.PROGRAMMER)).toBe(
        QueryCluster.CODE_GENERATION,
      );
    });

    it("empty prompt with no tool calls → falls back to task default", () => {
      expect(classifyQuery("", LLMTask.PLANNER, [])).toBe(
        QueryCluster.CROSS_FILE_REASONING,
      );
    });

    it("unrecognized tool calls fall through to keywords", () => {
      const toolCalls: ToolCallHint[] = [
        { name: "custom_unknown_tool" },
      ];
      expect(
        classifyQuery(
          "Refactor the auth module",
          LLMTask.PROGRAMMER,
          toolCalls,
        ),
      ).toBe(QueryCluster.COMPLEX_REFACTOR);
    });
  });
});
