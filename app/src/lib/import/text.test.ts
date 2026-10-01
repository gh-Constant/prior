import { describe, expect, it } from "vitest";
import { TODAY } from "./__fixtures__";
import { parseTextList } from "./text";

describe("parseTextList", () => {
  const read = (text: string) => parseTextList(text, { today: TODAY, lang: "en-US" });

  it("makes one task per line and drops bullets, numbers and boxes", () => {
    const batch = read("- Buy milk\n* Call mum\n1. Pay rent\n2) Book dentist\n[ ] Water plants\n\n  \nPlain line");
    expect(batch.source).toBe("text");
    expect(batch.tasks.map((task) => task.title)).toEqual(["Buy milk", "Call mum", "Pay rent", "Book dentist", "Water plants", "Plain line"]);
    expect(batch.projects).toEqual([]);
  });

  it("reads checked boxes as completed", () => {
    const batch = read("- [x] Done thing\n- [ ] Open thing\n[X] Another done");
    expect(batch.tasks.map((task) => [task.title, task.state, task.status])).toEqual([
      ["Done thing", "completed", "done"],
      ["Open thing", "open", "next"],
      ["Another done", "completed", "done"],
    ]);
  });

  it("makes sub-tasks from indentation", () => {
    const batch = read("- Launch\n  - Write copy\n  - Review\n    - Fix typos\n- Rest");
    const parents = batch.tasks.map((task) => task.parentKey && batch.tasks.find((candidate) => candidate.key === task.parentKey)?.title);
    expect(parents).toEqual([null, "Launch", "Launch", "Review", null]);
  });

  it("starts a project at each heading", () => {
    const batch = read("# Home\n- Fix tap\n## Work\n- Send invoice\n- Call Bob");
    expect(batch.tasks.map((task) => task.projectName)).toEqual(["Home", "Work", "Work"]);
    expect(batch.projects.map((project) => project.name)).toEqual(["Home", "Work"]);
  });

  it("uses what quick add understands for dates and priority", () => {
    const batch = read("- Call the bank tomorrow p1\n- Send report friday 3pm");
    expect(batch.tasks[0]).toMatchObject({ title: "Call the bank", dueDate: "2026-10-02", priority: 1, important: true, urgent: true });
    expect(batch.tasks[1]).toMatchObject({ title: "Send report", dueDate: "2026-10-02", dueTime: "15:00" });
  });
});
