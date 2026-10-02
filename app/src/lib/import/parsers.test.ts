import { describe, expect, it } from "vitest";
import { FIXTURES, TODAY } from "./__fixtures__";
import { analyzeFile, parseAll, parseAnalyzed } from "./analyze";
import { parseCsvTable } from "./csv";
import { detectMapping, parseTable, priorityFromText, statusFromText, stripNotionLinks } from "./generic";
import { parseLinear } from "./linear";
import { parseNotion } from "./notion";
import { parseTodoist, projectNameFromFile } from "./todoist";

const settings = { today: TODAY };
const byTitle = (tasks: ReadonlyArray<{ title: string }>, title: string) => {
  const task = tasks.find((candidate) => candidate.title === title);
  if (!task) throw new Error(`no task "${title}"`);
  return task as (typeof tasks)[number] & Record<string, unknown>;
};

describe("Todoist", () => {
  const batch = parseTodoist(parseCsvTable(FIXTURES.todoist.text), { fileName: FIXTURES.todoist.name, today: TODAY });

  it("reads one project named after the file, skipping sections and meta rows", () => {
    expect(batch.source).toBe("todoist");
    expect(batch.projects).toEqual([{ name: "Home", areaName: null, projectType: "standard" }]);
    expect(batch.tasks.map((task) => task.title)).toEqual([
      "Plan the launch", "Write the announcement", "Review with the team", "Draft the FAQ", "Water the plants",
      "Ship the beta", "Fix the login bug", "Back up the laptop", "Pay the rent", "Call the plumber",
    ]);
    expect(batch.tasks.every((task) => task.projectName === "Home")).toBe(true);
  });

  it("maps priority 4..1 to P1..P4", () => {
    expect(byTitle(batch.tasks, "Plan the launch")).toMatchObject({ priority: 1, important: true, urgent: true });
    expect(byTitle(batch.tasks, "Review with the team")).toMatchObject({ priority: 3 });
    expect(byTitle(batch.tasks, "Water the plants")).toMatchObject({ priority: 4, important: false });
    expect(byTitle(batch.tasks, "Back up the laptop")).toMatchObject({ priority: 3 });
  });

  it("builds sub-tasks from INDENT, parents first", () => {
    const keys = new Map(batch.tasks.map((task) => [task.title, task.key]));
    expect(byTitle(batch.tasks, "Plan the launch").parentKey).toBeNull();
    expect(byTitle(batch.tasks, "Write the announcement").parentKey).toBe(keys.get("Plan the launch"));
    expect(byTitle(batch.tasks, "Review with the team").parentKey).toBe(keys.get("Plan the launch"));
    expect(byTitle(batch.tasks, "Draft the FAQ").parentKey).toBe(keys.get("Review with the team"));
    expect(byTitle(batch.tasks, "Fix the login bug").parentKey).toBe(keys.get("Ship the beta"));
    expect(byTitle(batch.tasks, "Water the plants").parentKey).toBeNull();
  });

  it("appends notes to the task above and keeps who it is assigned to", () => {
    const review = byTitle(batch.tasks, "Review with the team");
    expect(review.description).toContain('Marie suggested a dry run\nbefore Friday, "no surprises" she said');
    expect(review.description).toContain("Assigned to: Marie (88)");
  });

  it("reads dates, times, deadlines and durations", () => {
    expect(byTitle(batch.tasks, "Plan the launch")).toMatchObject({ dueDate: "2026-10-12", description: "Outline the key steps, owners and dates" });
    expect(byTitle(batch.tasks, "Write the announcement")).toMatchObject({ dueDate: "2026-10-09", estimatedMinutes: 90 });
    expect(byTitle(batch.tasks, "Review with the team")).toMatchObject({ dueDate: "2026-10-14" });
    expect(byTitle(batch.tasks, "Ship the beta")).toMatchObject({ dueDate: "2026-10-02", dueTime: "14:30" });
    expect(byTitle(batch.tasks, "Pay the rent")).toMatchObject({ dueDate: "2026-10-15" });
  });

  it("turns repeat phrases into recurrences, out of the title", () => {
    const plants = byTitle(batch.tasks, "Water the plants");
    expect(plants.title).toBe("Water the plants");
    expect(plants).toMatchObject({ dueDate: null, recurrence: { interval: 1, unit: "week", daysOfWeek: [1] } });
    expect(plants.description).toBe("");
    const backup = byTitle(batch.tasks, "Back up the laptop");
    expect(backup.recurrence).toMatchObject({ interval: 2, unit: "week", basis: "completion" });
    expect(backup.description).toBe("");
  });

  it("puts tasks of a Doing section in progress and warns about unreadable dates", () => {
    expect(byTitle(batch.tasks, "Ship the beta").status).toBe("in_progress");
    expect(byTitle(batch.tasks, "Plan the launch").status).toBe("next");
    const plumber = byTitle(batch.tasks, "Call the plumber");
    expect(plumber).toMatchObject({ dueDate: null });
    expect(plumber.description).toBe("Date: someday maybe");
    expect(batch.warnings).toEqual([{ code: "dates", count: 1, file: "Home.csv" }]);
  });

  it("tolerates missing, renamed and extra columns, and older exports without TYPE", () => {
    const old = parseTodoist(parseCsvTable("CONTENT,PRIORITY,INDENT\nBuy milk,4,1\n  \nBuy eggs,1,2\n"), { fileName: "Groceries.csv", today: TODAY });
    expect(old.tasks.map((task) => [task.title, task.priority])).toEqual([["Buy milk", 1], ["Buy eggs", 4]]);
    expect(old.tasks[1].parentKey).toBe(old.tasks[0].key);
    expect(old.projects[0].name).toBe("Groceries");
  });

  it("derives a project name from file names", () => {
    expect(projectNameFromFile("Home [6Jf8VQXj].csv", "x")).toBe("Home");
    expect(projectNameFromFile("backup/Side projects.csv", "x")).toBe("Side projects");
    expect(projectNameFromFile(undefined, "Todoist")).toBe("Todoist");
  });
});

describe("Linear", () => {
  const batch = parseLinear(parseCsvTable(FIXTURES.linear.text), { today: TODAY });

  it("maps status by name, completed and canceled included but flagged", () => {
    expect(batch.source).toBe("linear");
    const status = (title: string) => {
      const task = byTitle(batch.tasks, title);
      return [task.status, task.state];
    };
    expect(status("Set up the CI pipeline")).toEqual(["in_progress", "open"]);
    expect(status("Cache the Docker layers")).toEqual(["next", "open"]);
    expect(status("Remove the legacy endpoint")).toEqual(["done", "completed"]);
    expect(status("Try the new editor")).toEqual(["done", "canceled"]);
    expect(status("Investigate flaky test")).toEqual(["inbox", "open"]);
    expect(status("Refresh the onboarding illustrations")).toEqual(["backlog", "open"]);
  });

  it("keeps a numeric Estimate as story points", () => {
    expect(byTitle(batch.tasks, "Set up the CI pipeline").storyPoints).toBe(3);
    expect(byTitle(batch.tasks, "Cache the Docker layers").storyPoints).toBeNull();
  });

  it("maps priority names", () => {
    expect(byTitle(batch.tasks, "Investigate flaky test").priority).toBe(1);
    expect(byTitle(batch.tasks, "Set up the CI pipeline").priority).toBe(2);
    expect(byTitle(batch.tasks, "Cache the Docker layers").priority).toBe(3);
    expect(byTitle(batch.tasks, "Remove the legacy endpoint").priority).toBe(4);
    expect(byTitle(batch.tasks, "Try the new editor").priority).toBe(4);
  });

  it("makes software projects, files loose issues under their team, and the team is the area", () => {
    expect(batch.projects).toEqual([
      { name: "Platform", areaName: "Engineering", projectType: "software" },
      { name: "Engineering", areaName: "Engineering", projectType: "software" },
      { name: "Design", areaName: "Design", projectType: "software" },
    ]);
    expect(byTitle(batch.tasks, "Investigate flaky test")).toMatchObject({ projectName: "Engineering", areaName: "Engineering" });
  });

  it("links parents through the issue id and keeps the rest in the description", () => {
    expect(byTitle(batch.tasks, "Cache the Docker layers").parentKey).toBe("ENG-1");
    const orphan = byTitle(batch.tasks, "Refresh the onboarding illustrations");
    expect(orphan.parentKey).toBeNull();
    expect(orphan.description).toContain("Parent issue: ENG-9");
    expect(batch.warnings).toEqual([{ code: "parents", count: 1 }]);
    const ci = byTitle(batch.tasks, "Set up the CI pipeline");
    expect(ci.description).toContain("Run lint, tests and build on every push.");
    expect(ci.description).toContain("Labels: infra, ci");
    expect(ci.description).toContain("Assignee: Marie");
    expect(ci.description).toContain("Milestone: Beta");
    expect(ci.description).toContain("Linear: ENG-1");
    expect(ci.dueDate).toBe("2026-10-10");
  });
});

describe("Notion and generic tables", () => {
  const batch = parseNotion(parseCsvTable(FIXTURES.notion.text), { fileName: FIXTURES.notion.name, today: TODAY });

  it("matches French headers, strips relation links and reads date ranges", () => {
    expect(batch.source).toBe("notion");
    expect(batch.tasks.map((task) => task.title)).toEqual(["Préparer la réunion", "Envoyer le devis", "Réserver le train", "Appeler la banque"]);
    expect(batch.projects).toEqual([{ name: "Site web", areaName: null, projectType: "standard" }]);
    expect(byTitle(batch.tasks, "Préparer la réunion")).toMatchObject({ dueDate: "2026-10-10", priority: 2, status: "in_progress", projectName: "Site web" });
    expect(byTitle(batch.tasks, "Préparer la réunion").description).toBe("Labels: client, urgent");
    expect(byTitle(batch.tasks, "Envoyer le devis")).toMatchObject({ dueDate: "2026-10-03", priority: 3, status: "next" });
  });

  it("reads the done checkbox, P1 and Not started, and the parent item", () => {
    expect(byTitle(batch.tasks, "Réserver le train")).toMatchObject({ state: "completed", status: "done", dueDate: "2026-10-01", priority: 4, projectName: null });
    expect(byTitle(batch.tasks, "Appeler la banque")).toMatchObject({ state: "open", status: "next", priority: 1 });
    expect(byTitle(batch.tasks, "Envoyer le devis").parentKey).toBe(byTitle(batch.tasks, "Préparer la réunion").key);
  });

  it("uses the database name as the project when there is no project column", () => {
    const plain = parseNotion(parseCsvTable("Name,Status\nWrite docs,In progress\nShip it,Done\n"), { fileName: "Roadmap 0123456789abcdef0123456789abcdef.csv" });
    expect(plain.projects.map((project) => project.name)).toEqual(["Roadmap"]);
    expect(plain.tasks.map((task) => [task.state, task.status])).toEqual([["open", "in_progress"], ["completed", "done"]]);
  });

  it("reads numeric dates in the order the file itself shows", () => {
    const table = parseCsvTable("Name,Date\nA,03/10/2026\nB,10/31/2026\n");
    const mdy = parseTable(table, detectMapping(table.headers), { today: TODAY, order: "dmy" });
    expect(mdy.tasks.map((task) => task.dueDate)).toEqual(["2026-03-10", "2026-10-31"]);
  });

  it("detects columns in the other languages", () => {
    expect(detectMapping(["Aufgabe", "Beschreibung", "Fällig", "Priorität", "Status", "Erledigt", "Projekt", "Schlagwörter"])).toMatchObject({ title: 0, description: 1, due: 2, priority: 3, status: 4, done: 5, project: 6, tags: 7 });
    expect(detectMapping(["Tarea", "Fecha límite", "Prioridad", "Estado"])).toMatchObject({ title: 0, due: 1, priority: 2, status: 3 });
    expect(detectMapping(["Tarefa", "Prazo", "Prioridade"])).toMatchObject({ title: 0, due: 1, priority: 2 });
    expect(detectMapping(["Date", "Due", "Name"])).toMatchObject({ title: 2, due: 1 });
    expect(detectMapping(["Foo", "Bar"]).title).toBe(0);
  });

  it("understands priority and status words", () => {
    expect(["Urgent", "High", "Medium", "Low", "Haute", "Moyenne", "Basse", "P2", "3", "Critical", "", "whatever"].map(priorityFromText)).toEqual([1, 2, 3, 4, 2, 3, 4, 2, 3, 1, null, null]);
    expect(statusFromText("Terminé")?.state).toBe("completed");
    expect(statusFromText("En cours")?.status).toBe("in_progress");
    expect(statusFromText("À faire")?.status).toBe("next");
    expect(statusFromText("Cancelled")?.state).toBe("canceled");
    expect(statusFromText("Blocked")?.status).toBe("waiting");
    expect(statusFromText("???")).toBeNull();
    expect(stripNotionLinks("Site web (https://www.notion.so/x), Blog (https://www.notion.so/y)")).toBe("Site web");
    expect(stripNotionLinks("Plain name")).toBe("Plain name");
  });

  it("reads a semicolon CSV with a user-chosen mapping", () => {
    const item = analyzeFile(FIXTURES.semicolon);
    expect(item.kind).toBe("table");
    const table = parseCsvTable(FIXTURES.semicolon.text);
    expect(table.delimiter).toBe(";");
    const generic = parseAnalyzed(item, settings);
    expect(generic.source).toBe("csv");
    expect(generic.tasks.map((task) => [task.title, task.dueDate, task.priority, task.projectName])).toEqual([
      ["Commander les cartes de visite", "2026-10-12", 2, "Bureau"],
      ["Renouveler l'assurance", "2026-10-31", 3, "Maison"],
      ["Tondre la pelouse", null, 4, "Maison"],
    ]);
    expect(generic.tasks[0].description).toBe("Format 85x55;\npapier recyclé");
    // Pointing "Date" at the notes column instead leaves the dates in the description.
    const mapping = { ...detectMapping(table.headers), due: 3, description: -1 };
    const remapped = parseTable(table, mapping, { today: TODAY });
    expect(remapped.tasks[0].dueDate).toBeNull();
    expect(remapped.tasks[0].description).toMatch(/^Date: Format 85x55/);
  });
});

describe("analyzing files", () => {
  it("recognises each export from its headers, not from its card", () => {
    expect(analyzeFile(FIXTURES.todoist).kind).toBe("todoist");
    expect(analyzeFile(FIXTURES.linear).kind).toBe("linear");
    expect(analyzeFile(FIXTURES.notion).kind).toBe("notion");
    expect(analyzeFile({ name: "pasted", text: "Buy milk\nCall mum" }).kind).toBe("text");
    expect(analyzeFile({ name: "list.txt", text: "Name,Due\nCall,Mon" }).kind).toBe("text");
    expect(analyzeFile({ name: "mystery.csv", text: "foo,bar\n1,2" })).toMatchObject({ kind: "table", unrecognised: true });
    expect(analyzeFile({ name: "pasted", text: "Name,Due\nCall,tomorrow" })).toMatchObject({ kind: "table", unrecognised: false });
  });

  it("merges several files into one batch", () => {
    const batch = parseAll([analyzeFile(FIXTURES.todoist), analyzeFile(FIXTURES.linear)], settings);
    expect(batch.tasks).toHaveLength(16);
    expect(new Set(batch.tasks.map((task) => task.key)).size).toBe(16);
    expect(batch.projects.map((project) => project.name)).toEqual(["Home", "Platform", "Engineering", "Design"]);
    expect(batch.projects.find((project) => project.name === "Home")?.projectType).toBe("standard");
  });
});
