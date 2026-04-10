import { describe, it, expect } from "@jest/globals";
import {
  formatPlanPrompt,
  formatPlanPromptWithSummaries,
} from "../utils/plan-prompt.js";
import { PlanItem } from "@openswe/shared/open-swe/types";

function makeItem(
  index: number,
  completed: boolean,
  plan = `Task ${index}`,
  summary?: string,
): PlanItem {
  return { index, plan, completed, summary };
}

describe("formatPlanPrompt", () => {
  it("single incomplete item becomes current_task with no completed/remaining sections", () => {
    const plan = [makeItem(0, false, "Do the thing")];
    const result = formatPlanPrompt(plan);
    expect(result).toContain("<current_task");
    expect(result).toContain("Do the thing");
    expect(result).toContain("No completed tasks.");
    expect(result).toContain("No remaining tasks.");
  });

  it("multiple items: first incomplete is current, others are remaining", () => {
    const plan = [
      makeItem(0, false, "First"),
      makeItem(1, false, "Second"),
      makeItem(2, false, "Third"),
    ];
    const result = formatPlanPrompt(plan);
    expect(result).toContain(`<current_task index="0">`);
    expect(result).toContain("First");
    expect(result).toContain(`<remaining_task index="1">`);
    expect(result).toContain("Second");
    expect(result).toContain(`<remaining_task index="2">`);
    expect(result).toContain("Third");
  });

  it("completed items appear in completed_task tags", () => {
    const plan = [
      makeItem(0, true, "Done one"),
      makeItem(1, false, "Current"),
    ];
    const result = formatPlanPrompt(plan);
    expect(result).toContain(`<completed_task index="0">`);
    expect(result).toContain("Done one");
    expect(result).toContain(`<current_task index="1">`);
    expect(result).toContain("Current");
  });

  it("useLastCompletedTask: true picks the lowest-index completed item as current", () => {
    const plan = [
      makeItem(0, true, "Completed A"),
      makeItem(1, true, "Completed B"),
      makeItem(2, false, "Pending"),
    ];
    const result = formatPlanPrompt(plan, { useLastCompletedTask: true });
    // index 0 is the lowest index completed item → becomes current
    expect(result).toContain(`<current_task index="0">`);
    expect(result).toContain("Completed A");
    // index 1 should be in completed tasks
    expect(result).toContain(`<completed_task index="1">`);
    expect(result).toContain("Completed B");
  });

  it("all completed + useLastCompletedTask: false shows 'No current task found.'", () => {
    const plan = [makeItem(0, true, "Done")];
    const result = formatPlanPrompt(plan, { useLastCompletedTask: false });
    expect(result).toContain("No current task found.");
  });
});

describe("formatPlanPromptWithSummaries", () => {
  it("completed item with summary includes task_summary tag", () => {
    const plan = [makeItem(0, true, "Completed task", "Summary here")];
    const result = formatPlanPromptWithSummaries(plan);
    expect(result).toContain("<completed_task");
    expect(result).toContain("<task_summary>");
    expect(result).toContain("Summary here");
  });

  it("completed item without summary shows 'No task summary found'", () => {
    const plan = [makeItem(0, true, "Completed task")];
    const result = formatPlanPromptWithSummaries(plan);
    expect(result).toContain("No task summary found");
  });

  it("incomplete item is not wrapped in completed_task tag", () => {
    const plan = [makeItem(0, false, "Pending task")];
    const result = formatPlanPromptWithSummaries(plan);
    expect(result).not.toContain("completed_task");
    expect(result).toContain("<task");
    expect(result).toContain("Pending task");
  });
});
