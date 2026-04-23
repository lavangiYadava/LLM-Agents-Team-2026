import { Hono } from "hono";
import { unifiedWebhookHandler } from "./github/unified-webhook.js";
import { RuntimeController } from "../runtime/runtime-controller.js";

export const runtimeController = new RuntimeController({
  budget: { maxTokens: 2_000_000, maxToolCalls: 200, maxActions: 150 },
  loop: {
    maxActions: 20,
    maxReviewCount: 3,
    maxWallClockMs: 30 * 60 * 1000,
    budgetWarningThreshold: 0.8,
  },
});

export const app = new Hono();

app.post("/webhooks/github", unifiedWebhookHandler);
