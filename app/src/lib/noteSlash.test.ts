import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, applySlashInsert, filterSlashCommands, matchSlashToken } from "./noteSlash";

describe("matchSlashToken", () => {
  it("detects a slash at the start of the document", () => {
    expect(matchSlashToken("/", 1)).toEqual({ query: "", start: 0 });
    expect(matchSlashToken("/ta", 3)).toEqual({ query: "ta", start: 0 });
  });

  it("detects a slash after a newline or a space", () => {
    expect(matchSlashToken("hello\n/h", 8)).toEqual({ query: "h", start: 6 });
    expect(matchSlashToken("hello /todo", 11)).toEqual({ query: "todo", start: 6 });
  });

  it("ignores slashes inside words", () => {
    expect(matchSlashToken("a/b", 3)).toBeNull();
    expect(matchSlashToken("hello", 5)).toBeNull();
    expect(matchSlashToken("call /api/v1", 11)).toBeNull();
  });
});

describe("filterSlashCommands", () => {
  it("returns every block when the query is empty", () => {
    expect(filterSlashCommands("")).toEqual(SLASH_COMMANDS);
  });

  it("filters blocks by label or keyword", () => {
    expect(filterSlashCommands("task").map((command) => command.id)).toEqual(["task"]);
    expect(filterSlashCommands("head").map((command) => command.id)).toEqual(["h1", "h2", "h3"]);
  });
});

describe("applySlashInsert", () => {
  it("replaces a token at the start of a line with the snippet", () => {
    const task = SLASH_COMMANDS.find((command) => command.id === "task")!;
    const next = applySlashInsert("Ideas\n/ta", 9, 6, task);
    expect(next).toEqual({ body: "Ideas\n- [ ] ", caret: 12 });
  });

  it("moves mid-line tokens onto their own line", () => {
    const divider = SLASH_COMMANDS.find((command) => command.id === "divider")!;
    const next = applySlashInsert("hello /", 7, 6, divider);
    expect(next).toEqual({ body: "hello \n---\n", caret: 11 });
  });

  it("places the caret inside code blocks and note links", () => {
    const code = SLASH_COMMANDS.find((command) => command.id === "code")!;
    const link = SLASH_COMMANDS.find((command) => command.id === "link")!;
    expect(applySlashInsert("/", 1, 0, code)).toEqual({ body: "```\n\n```", caret: 4 });
    expect(applySlashInsert("/", 1, 0, link)).toEqual({ body: "[[]]", caret: 2 });
  });
});
