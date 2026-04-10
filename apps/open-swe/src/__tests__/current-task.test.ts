import { describe, it, expect } from "@jest/globals";
import {
  getCurrentPlanItem,
  getCompletedPlanItems,
  getRemainingPlanItems,
} from "../utils/current-task.js";
import { PlanItem } from "@openswe/shared/open-swe/types";

function makeItem(
  index: number,
  completed: boolean,
  plan = `Task ${index}`,
): PlanItem {
  return { index, plan, completed };
}

describe("getCurrentPlanItem", () => {
  it("returns the lowest-index incomplete item", () => {
    const plan = [makeItem(2, false), makeItem(0, false), makeItem(1, false)];
    const result = getCurrentPlanItem(plan);
    expect(result.index).toBe(0);
  });

  // index 0 is completed, current task becomes index 1
  it("skips completed items", () => {
    const plan = [makeItem(0, true), makeItem(1, false), makeItem(2, false)];
    const result = getCurrentPlanItem(plan);
    expect(result.index).toBe(1);
  });

  it("returns fallback when plan is empty", () => {
    const result = getCurrentPlanItem([]);
    expect(result.plan).toBe("No current task found.");
    expect(result.index).toBe(-1);
  });

  it("returns fallback when all items are completed", () => {
    const plan = [makeItem(0, true), makeItem(1, true)];
    const result = getCurrentPlanItem(plan);
    expect(result.plan).toBe("No current task found.");
    expect(result.index).toBe(-1);
  });
});

describe("getCompletedPlanItems", () => {
  it("returns only completed items", () => {
    const plan = [makeItem(0, true), makeItem(1, false), makeItem(2, true)];
    const result = getCompletedPlanItems(plan);
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.completed)).toBe(true);
  });

  it("returns empty array when no items are completed", () => {
    const plan = [makeItem(0, false), makeItem(1, false)];
    expect(getCompletedPlanItems(plan)).toHaveLength(0);
  });

  it("returns empty array for empty plan", () => {
    expect(getCompletedPlanItems([])).toHaveLength(0);
  });
});

describe("getRemainingPlanItems", () => {
  it("excludes the current item by default", () => {
    const plan = [makeItem(0, false), makeItem(1, false), makeItem(2, false)];
    const result = getRemainingPlanItems(plan);
    // current is index 0; remaining should be 1 and 2
    expect(result.map((p) => p.index)).toEqual([1, 2]);
  });

  it("includes the current item when includeCurrentPlanItem is true", () => {
    const plan = [makeItem(0, false), makeItem(1, false), makeItem(2, false)];
    const result = getRemainingPlanItems(plan, true);
    expect(result.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("excludes completed items", () => {
    const plan = [makeItem(0, true), makeItem(1, false), makeItem(2, false)];
    const result = getRemainingPlanItems(plan);
    // current is index 1; remaining should only be index 2
    expect(result.map((p) => p.index)).toEqual([2]);
  });

  it("result is sorted by index", () => {
    const plan = [makeItem(3, false), makeItem(1, false), makeItem(2, false)];
    const result = getRemainingPlanItems(plan);
    const indices = result.map((p) => p.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("returns empty array when all items are completed", () => {
    const plan = [makeItem(0, true), makeItem(1, true)];
    expect(getRemainingPlanItems(plan)).toHaveLength(0);
  });
});
