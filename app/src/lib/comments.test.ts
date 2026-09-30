import { describe, expect, it } from "vitest";
import { commentParts, extractMentions, filterMentionables, insertMention, mentionQuery } from "./comments";

const members = [
  { userId: "a", displayName: "Ada Lovelace" },
  { userId: "b", displayName: "Bob" },
  { userId: "c", displayName: "Bobby Tables" },
];

describe("comment helpers", () => {
  it("detects the mention being typed", () => {
    expect(mentionQuery("Hi @Bo", 6)).toEqual({ query: "Bo", start: 3 });
    expect(mentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(mentionQuery("mail me@home", 12)).toBeNull();
    expect(mentionQuery("Hi @Bob done", 12)).toBeNull();
  });

  it("filters members by name start and inserts the mention", () => {
    expect(filterMentionables(members, "lov").map((member) => member.userId)).toEqual(["a"]);
    expect(filterMentionables(members, "bo", "b").map((member) => member.userId)).toEqual(["c"]);
    expect(insertMention("Hi @Bo!", 3, 6, members[1])).toEqual({ text: "Hi @Bob !", caret: 8 });
  });

  it("extracts only whole mentions, preferring longer names", () => {
    expect(extractMentions("thanks @Bobby Tables and @ada lovelace", members).sort()).toEqual(["a", "c"]);
    expect(extractMentions("email@Bob.com", members)).toEqual([]);
    expect(extractMentions("(@Bob) ok", members)).toEqual(["b"]);
  });

  it("renders links and mentions from plain text only", () => {
    expect(commentParts("See https://example.com/x?y=1. @Bob <b>hi</b>", members)).toEqual([
      { kind: "text", value: "See " },
      { kind: "link", value: "https://example.com/x?y=1", href: "https://example.com/x?y=1" },
      { kind: "text", value: ". " },
      { kind: "mention", value: "@Bob", userId: "b" },
      { kind: "text", value: " <b>hi</b>" },
    ]);
    expect(commentParts("javascript:alert(1)")).toEqual([{ kind: "text", value: "javascript:alert(1)" }]);
  });
});

describe("mention notifications", () => {
  it("announces each unread mention once per device", async () => {
    const { newMentionsToNotify } = await import("./comments");
    localStorage.clear();
    const mentions = [{ commentId: "c1" }, { commentId: "c2", readAt: "2026-01-01" }];
    expect(newMentionsToNotify(mentions).map((mention) => mention.commentId)).toEqual(["c1"]);
    expect(newMentionsToNotify(mentions)).toEqual([]);
    expect(newMentionsToNotify([...mentions, { commentId: "c3" }]).map((mention) => mention.commentId)).toEqual(["c3"]);
  });
});
