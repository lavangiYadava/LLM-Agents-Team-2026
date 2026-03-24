import { describe, it, expect } from "@jest/globals";
import { escapeRegExp } from "../utils/string-utils.js";

describe("escapeRegExp", () => {
  it("returns plain string unchanged", () => {
    expect(escapeRegExp("hello world")).toBe("hello world");
  });

  it("returns empty string for empty input", () => {
    expect(escapeRegExp("")).toBe("");
  });

  it("escapes dot", () => {
    expect(escapeRegExp(".")).toBe("\\.");
  });

  it("escapes asterisk", () => {
    expect(escapeRegExp("*")).toBe("\\*");
  });

  it("escapes plus", () => {
    expect(escapeRegExp("+")).toBe("\\+");
  });

  it("escapes question mark", () => {
    expect(escapeRegExp("?")).toBe("\\?");
  });

  it("escapes caret", () => {
    expect(escapeRegExp("^")).toBe("\\^");
  });

  it("escapes dollar sign", () => {
    expect(escapeRegExp("$")).toBe("\\$");
  });

  it("escapes curly braces", () => {
    expect(escapeRegExp("{")).toBe("\\{");
    expect(escapeRegExp("}")).toBe("\\}");
  });

  it("escapes parentheses", () => {
    expect(escapeRegExp("(")).toBe("\\(");
    expect(escapeRegExp(")")).toBe("\\)");
  });

  it("escapes pipe", () => {
    expect(escapeRegExp("|")).toBe("\\|");
  });

  it("escapes square brackets", () => {
    expect(escapeRegExp("[")).toBe("\\[");
    expect(escapeRegExp("]")).toBe("\\]");
  });

  it("escapes backslash", () => {
    expect(escapeRegExp("\\")).toBe("\\\\");
  });

  it("escapes multiple metacharacters in one string", () => {
    expect(escapeRegExp("a.b*c+d?")).toBe("a\\.b\\*c\\+d\\?");
  });

  it("round-trip: escaped string matches itself literally in RegExp", () => {
    const input = "hello.world[0]";
    const escaped = escapeRegExp(input);
    const regex = new RegExp(escaped);
    expect(regex.test(input)).toBe(true);
    // should not match a modified version where . acts as wildcard
    expect(regex.test("helloXworld[0]")).toBe(false);
  });
});
