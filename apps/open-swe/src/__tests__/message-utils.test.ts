import { describe, it, expect } from "@jest/globals";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { filterHiddenMessages } from "../utils/message/filter-hidden.js";
import {
  removeFirstHumanMessage,
  removeLastHumanMessage,
} from "../utils/message/modify-array.js";
import {
  filterMessagesWithoutContent,
  getToolCallsString,
  getAIMessageString,
  getHumanMessageString,
  getToolMessageString,
} from "../utils/message/content.js";

describe("filterHiddenMessages", () => {
  it("removes messages with additional_kwargs.hidden: true", () => {
    const messages = [
      new HumanMessage({ content: "visible" }),
      new HumanMessage({ content: "hidden", additional_kwargs: { hidden: true } }),
    ];
    const result = filterHiddenMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("visible");
  });

  it("returns all messages when none are hidden", () => {
    const messages = [
      new HumanMessage({ content: "a" }),
      new HumanMessage({ content: "b" }),
    ];
    expect(filterHiddenMessages(messages)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(filterHiddenMessages([])).toHaveLength(0);
  });
});

describe("removeFirstHumanMessage", () => {
  it("removes the first HumanMessage", () => {
    const messages = [
      new HumanMessage({ content: "first" }),
      new AIMessage({ content: "ai" }),
      new HumanMessage({ content: "second" }),
    ];
    const result = removeFirstHumanMessage(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("ai");
    expect(result[1].content).toBe("second");
  });

  it("returns unchanged array when there are no HumanMessages", () => {
    const messages = [new AIMessage({ content: "only ai" })];
    const result = removeFirstHumanMessage(messages);
    expect(result).toHaveLength(1);
  });
});

describe("removeLastHumanMessage", () => {
  it("removes the last HumanMessage", () => {
    const messages = [
      new HumanMessage({ id: "h1", content: "first" }),
      new AIMessage({ id: "a1", content: "ai" }),
      new HumanMessage({ id: "h2", content: "last" }),
    ];
    const result = removeLastHumanMessage(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("first");
    expect(result[1].content).toBe("ai");
  });

  it("removes the single HumanMessage", () => {
    const messages = [new HumanMessage({ content: "only" })];
    const result = removeLastHumanMessage(messages);
    expect(result).toHaveLength(0);
  });

  it("returns unchanged array when there are no HumanMessages", () => {
    const messages = [new AIMessage({ content: "ai only" })];
    expect(removeLastHumanMessage(messages)).toHaveLength(1);
  });
});

describe("filterMessagesWithoutContent", () => {
  it("removes messages with empty content", () => {
    const messages = [
      new HumanMessage({ content: "" }),
      new HumanMessage({ content: "hello" }),
    ];
    const result = filterMessagesWithoutContent(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello");
  });

  it("keeps AI messages with tool calls but no content", () => {
    const ai = new AIMessage({
      content: "",
      tool_calls: [{ name: "my_tool", args: {}, id: "c1" }],
    });
    const result = filterMessagesWithoutContent([ai]);
    expect(result).toHaveLength(1);
  });

  it("removes hidden messages when filterHidden is true (default)", () => {
    const messages = [
      new HumanMessage({ content: "visible" }),
      new HumanMessage({ content: "hidden", additional_kwargs: { hidden: true } }),
    ];
    const result = filterMessagesWithoutContent(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("visible");
  });

  it("keeps hidden messages when filterHidden is false", () => {
    const messages = [
      new HumanMessage({ content: "visible" }),
      new HumanMessage({ content: "hidden", additional_kwargs: { hidden: true } }),
    ];
    const result = filterMessagesWithoutContent(messages, false);
    expect(result).toHaveLength(2);
  });
});

describe("getToolCallsString", () => {
  it("returns empty string for undefined", () => {
    expect(getToolCallsString(undefined)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(getToolCallsString([])).toBe("");
  });

  it("returns JSON for a single tool call", () => {
    const call = { name: "my_tool", args: { key: "val" }, id: "c1" };
    const result = getToolCallsString([call]);
    expect(result).toContain("my_tool");
    expect(result).toContain("val");
  });

  it("joins multiple tool calls with newlines", () => {
    const calls = [
      { name: "tool_a", args: {}, id: "c1" },
      { name: "tool_b", args: {}, id: "c2" },
    ];
    const result = getToolCallsString(calls);
    expect(result).toContain("tool_a");
    expect(result).toContain("tool_b");
    expect(result.split("\n").length).toBeGreaterThan(1);
  });
});

describe("getAIMessageString", () => {
  it("includes assistant tag and content", () => {
    const msg = new AIMessage({ content: "Hello there" });
    const result = getAIMessageString(msg);
    expect(result).toContain("<assistant");
    expect(result).toContain("Hello there");
    expect(result).toContain("</assistant>");
  });

  it("includes tool calls in output", () => {
    const msg = new AIMessage({
      content: "Calling tool",
      tool_calls: [{ name: "search", args: { q: "test" }, id: "c1" }],
    });
    const result = getAIMessageString(msg);
    expect(result).toContain("search");
  });
});

describe("getHumanMessageString", () => {
  it("includes human tag and content", () => {
    const msg = new HumanMessage({ content: "User input" });
    const result = getHumanMessageString(msg);
    expect(result).toContain("<human");
    expect(result).toContain("User input");
    expect(result).toContain("</human>");
  });
});

describe("getToolMessageString", () => {
  it("includes tool tag, tool call id, and content", () => {
    const msg = new ToolMessage({
      content: "Tool result",
      tool_call_id: "call-123",
      name: "my_tool",
    });
    const result = getToolMessageString(msg);
    expect(result).toContain("<tool");
    expect(result).toContain("call-123");
    expect(result).toContain("Tool result");
    expect(result).toContain("</tool>");
  });

  it("includes status field in output", () => {
    const msg = new ToolMessage({
      content: "done",
      tool_call_id: "c1",
      status: "error",
    });
    const result = getToolMessageString(msg);
    expect(result).toContain("error");
  });
});
