import { describe, it, expect } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import {
  extractIssueTitleAndContentFromMessage,
  formatContentForIssueBody,
  getMessageContentFromIssue,
  getUntrackedComments,
  ISSUE_TITLE_OPEN_TAG,
  ISSUE_TITLE_CLOSE_TAG,
  ISSUE_CONTENT_OPEN_TAG,
  ISSUE_CONTENT_CLOSE_TAG,
} from "../utils/github/issue-messages.js";
import { GitHubIssue, GitHubIssueComment } from "../utils/github/types.js";

// minimal type helpers
function makeIssue(title: string, body: string): GitHubIssue {
  return { title, body, number: 1 } as GitHubIssue;
}

function makeComment(id: number, body: string): GitHubIssueComment {
  return { id, body } as GitHubIssueComment;
}

describe("extractIssueTitleAndContentFromMessage", () => {
  it("parses title and content from tagged string", () => {
    const input = `${ISSUE_TITLE_OPEN_TAG}My Title${ISSUE_TITLE_CLOSE_TAG}${ISSUE_CONTENT_OPEN_TAG}My Content${ISSUE_CONTENT_CLOSE_TAG}`;
    const result = extractIssueTitleAndContentFromMessage(input);
    expect(result.title).toBe("My Title");
    expect(result.content).toBe("My Content");
  });

  it("returns null title when title tags are missing", () => {
    const input = `${ISSUE_CONTENT_OPEN_TAG}Just content${ISSUE_CONTENT_CLOSE_TAG}`;
    const result = extractIssueTitleAndContentFromMessage(input);
    expect(result.title).toBeNull();
    expect(result.content).toBe("Just content");
  });

  it("returns full string as content when content tags are missing", () => {
    const input = "plain string with no tags";
    const result = extractIssueTitleAndContentFromMessage(input);
    expect(result.title).toBeNull();
    expect(result.content).toBe(input);
  });

  it("returns null title and full string when no tags present", () => {
    const input = "no tags here";
    const result = extractIssueTitleAndContentFromMessage(input);
    expect(result.title).toBeNull();
    expect(result.content).toBe("no tags here");
  });
});

describe("formatContentForIssueBody", () => {
  it("wraps content in open-swe-issue-content tags", () => {
    const result = formatContentForIssueBody("hello");
    expect(result).toBe(
      `${ISSUE_CONTENT_OPEN_TAG}hello${ISSUE_CONTENT_CLOSE_TAG}`,
    );
  });

  it("round-trips with extractIssueTitleAndContentFromMessage", () => {
    const body = "some issue body text";
    const formatted = formatContentForIssueBody(body);
    const extracted = extractIssueTitleAndContentFromMessage(formatted);
    expect(extracted.content).toBe(body);
  });
});

describe("getMessageContentFromIssue", () => {
  it("formats an issue (has title) with [original issue] header", () => {
    const issue = makeIssue("Bug report", "Something is broken.");
    const result = getMessageContentFromIssue(issue);
    expect(result).toContain("[original issue]");
    expect(result).toContain("Bug report");
    expect(result).toContain("Something is broken.");
  });

  it("formats a comment (no title) with [issue comment] header", () => {
    const comment = makeComment(42, "This is a comment.");
    const result = getMessageContentFromIssue(comment);
    expect(result).toContain("[issue comment]");
    expect(result).toContain("This is a comment.");
  });

  it("strips outer body and extracts content from inside <details> block", () => {
    // the function takes the substring inside <details>...</details>, then
    // runs extractContentFromIssueBody on it. So the actual content must be
    // wrapped in ISSUE_CONTENT tags inside the details block.
    const body = `<details>${ISSUE_CONTENT_OPEN_TAG}Actual content${ISSUE_CONTENT_CLOSE_TAG}</details>`;
    const issue = makeIssue("Title", body);
    const result = getMessageContentFromIssue(issue);
    expect(result).not.toContain("<details>");
    expect(result).toContain("Actual content");
  });
});

describe("getUntrackedComments", () => {
  it("returns HumanMessage for each comment not already tracked", () => {
    const comments = [makeComment(1, "First"), makeComment(2, "Second")];
    const result = getUntrackedComments([], 100, comments);
    expect(result).toHaveLength(2);
    result.forEach((m) => expect(m).toBeInstanceOf(HumanMessage));
  });

  it("skips comments already tracked by githubIssueCommentId", () => {
    const tracked = new HumanMessage({
      content: "already tracked",
      additional_kwargs: { githubIssueCommentId: 1 },
    });
    const comments = [makeComment(1, "First"), makeComment(2, "Second")];
    const result = getUntrackedComments([tracked], 100, comments);
    expect(result).toHaveLength(1);
    expect(
      (result[0] as HumanMessage).additional_kwargs?.githubIssueCommentId,
    ).toBe(2);
  });

  it("returns empty array when all comments are already tracked", () => {
    const tracked = new HumanMessage({
      content: "tracked",
      additional_kwargs: { githubIssueCommentId: 5 },
    });
    const comments = [makeComment(5, "A comment")];
    const result = getUntrackedComments([tracked], 100, comments);
    expect(result).toHaveLength(0);
  });

  it("ignores original issue messages when checking tracked comments", () => {
    // isOriginalIssue messages should not count as tracked comments
    const originalIssueMsg = new HumanMessage({
      content: "original issue",
      additional_kwargs: { isOriginalIssue: true, githubIssueCommentId: 1 },
    });
    const comments = [makeComment(1, "A comment")];
    // since getUntrackedComments filters out isOriginalIssue messages from humanMessages,
    // comment 1 should still appear as untracked
    const result = getUntrackedComments([originalIssueMsg], 100, comments);
    expect(result).toHaveLength(1);
  });
});
