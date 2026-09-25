import { describe, expect, it } from "vitest";
import type { Note, NoteFolder } from "../../lib/notes";
import { countWords, extractOutline, extractTags, findBacklinks, findNeighbors, folderChain, foldersWithNotes, relativeTime } from "./noteInsights";

function note(id: string, title: string, body: string, folderId: string | null = null): Note {
  return { id, title, body, folderId, favorite: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null };
}

function folder(id: string, name: string, parentId: string | null): NoteFolder {
  return { id, name, parentId, color: null, createdAt: "", updatedAt: "", deletedAt: null };
}

describe("note insights", () => {
  it("builds an outline that ignores headings inside fenced code", () => {
    const body = "# Intro\ntext\n```md\n# not a heading\n```\n## **Links** and [[Tags|tags]]\n### `Deep`";
    expect(extractOutline(body)).toEqual([
      { level: 1, text: "Intro", line: 0 },
      { level: 2, text: "Links and tags", line: 5 },
      { level: 3, text: "Deep", line: 6 },
    ]);
  });

  it("collects unique tags outside code, skipping headings markers and numbers", () => {
    const body = "## Plan\nSee #ideas and #Guide, not `#code` or #42.\n```\n#hidden\n```\nAgain #ideas";
    expect(extractTags(body)).toEqual(["ideas", "Guide"]);
  });

  it("counts words like the inspector always has", () => {
    expect(countWords("  one two\nthree  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });

  it("finds backlinks and neighbors case-insensitively, including heading and alias links", () => {
    const target = note("a", "Launch plan", "Links to [[Reading list]].");
    const reading = note("b", "Reading list", "Back to [[launch plan#Goals|the plan]]");
    const other = note("c", "Other", "Mentions [[Launch Plan]] too");
    const unrelated = note("d", "Unrelated", "Nothing here");
    const all = [target, reading, other, unrelated];
    expect(findBacklinks(target, all).map((item) => item.id)).toEqual(["b", "c"]);
    expect(findNeighbors(target, all).map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("resolves folder ancestry and the folders that contain matching notes", () => {
    const folders = [folder("root", "Work", null), folder("child", "Launch", "root"), folder("empty", "Empty", null)];
    expect(folderChain("child", folders).map((item) => item.name)).toEqual(["Work", "Launch"]);
    expect([...foldersWithNotes([note("n", "N", "", "child")], folders)].sort()).toEqual(["child", "root"]);
  });

  it("formats recent edits relatively and defers older ones to a date", () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    expect(relativeTime("2026-09-23T11:59:50.000Z", "en", now)).toBe("now");
    expect(relativeTime("2026-09-23T11:58:00.000Z", "en", now)).toBe("2 min. ago");
    expect(relativeTime("2026-09-23T09:00:00.000Z", "en", now)).toBe("3 hr. ago");
    expect(relativeTime("2026-09-01T12:00:00.000Z", "en", now)).toBeNull();
  });
});
