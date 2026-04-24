import { describe, expect, it } from "@jest/globals";
import { checkFeasibility, BudgetConfig, TaskContext } from "../feasibility.js";

function makeConfig(overrides?: Partial<BudgetConfig>): BudgetConfig {
  return {
    maxTokens: 100000,
    maxToolCalls: 200,
    maxActions: 150,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<TaskContext>): TaskContext {
  return {
    issue_body: "Fix the bug",
    referenced_file_count: 0,
    repo_line_count: 0,
    ...overrides,
  };
}

describe("checkFeasibility", () => {
  it("returns feasible: false when estimated tokens exceed maxTokens", () => {
    const config = makeConfig({ maxTokens: 100 });
    const context = makeContext({ issue_body: "a".repeat(2000) });
    const result = checkFeasibility(config, context);
    expect(result.feasible).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it("returns feasible: true and confidence high when well within budget", () => {
    const config = makeConfig({ maxTokens: 100000 });
    const context = makeContext({
      issue_body: "a".repeat(50),
      referenced_file_count: 0,
    });
    const result = checkFeasibility(config, context);
    expect(result.feasible).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("returns feasible: true with confidence low and a warning when near limit", () => {
    const estimatedBase = 2000;
    const targetTokens = Math.ceil(estimatedBase / 0.9);
    const config = makeConfig({ maxTokens: targetTokens });
    const context = makeContext({
      issue_body: "",
      referenced_file_count: 0,
      repo_line_count: 0,
    });
    const result = checkFeasibility(config, context);
    const ratio = estimatedBase / targetTokens;
    expect(ratio).toBeGreaterThanOrEqual(0.85);
    expect(ratio).toBeLessThanOrEqual(1.0);
    expect(result.feasible).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.warning).toBeDefined();
  });

  it("handles zero repo_line_count without throwing", () => {
    const config = makeConfig();
    const context = makeContext({ repo_line_count: 0 });
    expect(() => checkFeasibility(config, context)).not.toThrow();
    const result = checkFeasibility(config, context);
    expect(result.feasible).toBe(true);
  });
});
