import { describe, it, expect } from "@jest/globals";
import { truncateOutput } from "../utils/truncate-outputs.js";

describe("truncateOutput", () => {
  it("returns short string unchanged", () => {
    const input = "hello world";
    expect(truncateOutput(input)).toBe(input);
  });

  it("returns empty string unchanged", () => {
    expect(truncateOutput("")).toBe("");
  });

  it("truncates string exceeding budget and includes marker and character count", () => {
    const start = "A".repeat(2500);
    const end = "B".repeat(2500);
    const extra = "C".repeat(100);
    const input = start + extra + end;
    const result = truncateOutput(input);
    expect(result).toContain("[content truncated]");
    expect(result).toContain(String(input.length));
  });

  it("truncates at exact budget boundary: length equals budget returns unchanged", () => {
    const input = "X".repeat(5000);
    expect(truncateOutput(input)).toBe(input);
  });

  it("truncates when length exceeds budget by 1", () => {
    const input = "X".repeat(5001);
    const result = truncateOutput(input);
    expect(result).toContain("[content truncated]");
  });

  it("numEndCharacters: 0 gives head-only truncation", () => {
    const head = "HEAD".repeat(200);
    const tail = "TAIL".repeat(200);
    const input = head + tail;
    const result = truncateOutput(input, {
      numStartCharacters: 100,
      numEndCharacters: 0,
    });
    expect(result).toContain("[content truncated]");
    // head portion should be present
    expect(result).toContain(input.slice(0, 100));
  });

  it("numStartCharacters: 0 gives tail-only truncation", () => {
    const head = "HEAD".repeat(200);
    const tail = "TAIL".repeat(200);
    const input = head + tail;
    const result = truncateOutput(input, {
      numStartCharacters: 0,
      numEndCharacters: 100,
    });
    expect(result).toContain("[content truncated]");
    expect(result).toContain(input.slice(-100));
  });

  it("throws when both numStartCharacters and numEndCharacters are 0", () => {
    expect(() =>
      truncateOutput("some text", {
        numStartCharacters: 0,
        numEndCharacters: 0,
      }),
    ).toThrow();
  });

  it("throws when numStartCharacters is negative", () => {
    expect(() =>
      truncateOutput("some text", { numStartCharacters: -1 }),
    ).toThrow();
  });

  it("throws when numEndCharacters is negative", () => {
    expect(() =>
      truncateOutput("some text", { numEndCharacters: -1 }),
    ).toThrow();
  });

  it("uses custom numStartCharacters and numEndCharacters", () => {
    const input = "A".repeat(50) + "B".repeat(50);
    const result = truncateOutput(input, {
      numStartCharacters: 10,
      numEndCharacters: 10,
    });
    expect(result).toContain("[content truncated]");
    expect(result).toContain("A".repeat(10));
    expect(result).toContain("B".repeat(10));
  });
});
