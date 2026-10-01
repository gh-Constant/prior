import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { analyzeFile } from "./analyze";
import { FIXTURES } from "./__fixtures__";
import { decodeText, isZipBytes, readImportBytes } from "./zip";

describe("readImportBytes", () => {
  it("reads a Todoist backup: one CSV per project, ignoring other files", () => {
    const archive = zipSync({
      "Home.csv": strToU8(FIXTURES.todoist.text),
      "Work.csv": strToU8("TYPE,CONTENT\ntask,Send invoice\n"),
      "README.txt": strToU8("not a csv"),
      "__MACOSX/._Home.csv": strToU8("junk"),
    });
    expect(isZipBytes(archive)).toBe(true);
    const { files, warnings } = readImportBytes("Todoist backup.zip", archive);
    expect(files.map((file) => file.name)).toEqual(["Home.csv", "Work.csv"]);
    expect(warnings).toEqual([]);
    expect(analyzeFile(files[0]).kind).toBe("todoist");
  });

  it("reads Notion exports, nested archives included, and skips _all.csv duplicates", () => {
    const inner = zipSync({
      "Export/Projects/Tasks 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.csv": strToU8(FIXTURES.notion.text),
      "Export/Projects/Tasks 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d_all.csv": strToU8(FIXTURES.notion.text),
      "Export/Projects/Tasks/Page abc.md": strToU8("# page"),
    });
    const outer = zipSync({ "Export-1234-Part-1.zip": inner });
    const { files } = readImportBytes("export.zip", outer);
    expect(files.map((file) => file.name)).toEqual(["Tasks 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.csv"]);
    expect(analyzeFile(files[0]).kind).toBe("notion");
  });

  it("explains an archive with no CSV and survives a corrupt one", () => {
    expect(readImportBytes("empty.zip", zipSync({ "a.txt": strToU8("x") })).warnings).toEqual([{ code: "noCsv", file: "empty.zip" }]);
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
    const { files, warnings } = readImportBytes("bad.zip", corrupt);
    expect(files).toEqual([]);
    expect(warnings).toEqual([{ code: "archive", file: "bad.zip" }]);
  });

  it("reads a plain file by name and decodes Windows-1252 spreadsheets", () => {
    expect(readImportBytes("dir/tasks.csv", strToU8("a,b\n1,2")).files).toEqual([{ name: "tasks.csv", text: "a,b\n1,2" }]);
    expect(decodeText(new Uint8Array([0x54, 0xe2, 0x63, 0x68, 0x65]))).toBe("Tâche");
    expect(decodeText(strToU8("Tâche"))).toBe("Tâche");
  });
});
