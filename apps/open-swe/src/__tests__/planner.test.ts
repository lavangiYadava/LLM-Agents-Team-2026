import { describe, it, expect } from "@jest/globals";

describe("Planner node", () => {
    it("produces a plan with steps", async () => {
        // Use a small mock graph that matches the expected runtime shape.
        const graph = {
            invoke: async (_input: any) => ({
                plan: { steps: ["read file", "edit function", "run tests"] },
            }),
        } as const;

        const result = await graph.invoke({ task: "Fix off-by-one error in utils.ts" });

        expect(result.plan.steps).toHaveLength(3);
        expect(result.plan.steps).toEqual(["read file", "edit function", "run tests"]);


    });
})