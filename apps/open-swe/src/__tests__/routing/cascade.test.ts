import { describe, expect, it } from "@jest/globals";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import type { AIMessageChunk } from "@langchain/core/messages";
import {
  checkOutputQuality,
  decideCascade,
} from "../../runtime/routing/cascade.js";
import { ModelTier } from "../../runtime/routing/model-tiers.js";

function makeResponse(overrides: Partial<AIMessageChunk>): AIMessageChunk {
  return {
    content: "valid response",
    tool_calls: [],
    response_metadata: {},
    ...overrides,
  } as unknown as AIMessageChunk;
}

describe("checkOutputQuality", () => {
  it("passes for valid response with content", () => {
    const result = checkOutputQuality(
      makeResponse({ content: "hello" }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(true);
  });

  it("passes for response with tool calls but no content", () => {
    const result = checkOutputQuality(
      makeResponse({
        content: "",
        tool_calls: [{ name: "read_file", args: { path: "." }, id: "1", type: "tool_call" }],
      }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(true);
  });

  it("detects empty response (no content, no tool calls)", () => {
    const result = checkOutputQuality(
      makeResponse({ content: "", tool_calls: [] }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("empty_response");
  });

  it("detects malformed tool calls (name but no args)", () => {
    const result = checkOutputQuality(
      makeResponse({
        tool_calls: [{ name: "read_file", args: undefined, id: "1", type: "tool_call" }] as any,
      }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("malformed_tool_call");
  });

  it("detects model refusal for PROGRAMMER task", () => {
    const result = checkOutputQuality(
      makeResponse({ content: "I cannot help with that request" }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("model_refusal");
  });

  it("does not flag refusal for non-PROGRAMMER task", () => {
    const result = checkOutputQuality(
      makeResponse({ content: "I cannot help with that request" }),
      LLMTask.SUMMARIZER,
    );
    expect(result.passed).toBe(true);
  });

  it("detects 'as an ai' refusal pattern", () => {
    const result = checkOutputQuality(
      makeResponse({
        content: "As an AI, I need to clarify that I can't do that",
      }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("model_refusal");
  });

  it("detects truncated output (finish_reason=length)", () => {
    const result = checkOutputQuality(
      makeResponse({
        response_metadata: { finish_reason: "length" },
      }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("truncated_output");
  });

  it("passes for normal finish_reason=stop", () => {
    const result = checkOutputQuality(
      makeResponse({
        response_metadata: { finish_reason: "stop" },
      }),
      LLMTask.PROGRAMMER,
    );
    expect(result.passed).toBe(true);
  });
});

describe("decideCascade", () => {
  it("does not escalate when quality passed", () => {
    const result = decideCascade(
      ModelTier.ECONOMY,
      { passed: true },
      false,
    );
    expect(result.shouldEscalate).toBe(false);
  });

  it("escalates ECONOMY to STANDARD on quality failure", () => {
    const result = decideCascade(
      ModelTier.ECONOMY,
      { passed: false, reason: "empty_response" },
      false,
    );
    expect(result.shouldEscalate).toBe(true);
    expect(result.targetTier).toBe(ModelTier.STANDARD);
    expect(result.reason).toBe("empty_response");
  });

  it("escalates STANDARD to PREMIUM on quality failure", () => {
    const result = decideCascade(
      ModelTier.STANDARD,
      { passed: false, reason: "model_refusal" },
      false,
    );
    expect(result.shouldEscalate).toBe(true);
    expect(result.targetTier).toBe(ModelTier.PREMIUM);
  });

  it("does not escalate if already PREMIUM", () => {
    const result = decideCascade(
      ModelTier.PREMIUM,
      { passed: false, reason: "empty_response" },
      false,
    );
    expect(result.shouldEscalate).toBe(false);
    expect(result.reason).toBe("already_premium");
  });

  it("does not escalate if budget exhausted", () => {
    const result = decideCascade(
      ModelTier.ECONOMY,
      { passed: false, reason: "empty_response" },
      true,
    );
    expect(result.shouldEscalate).toBe(false);
    expect(result.reason).toBe("budget_exhausted");
  });
});
