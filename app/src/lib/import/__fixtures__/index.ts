import todoistHome from "./Home.csv?raw";
import linear from "./linear.csv?raw";
import notionTasks from "./Tasks 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.csv?raw";
import semicolon from "./semicolon.csv?raw";

/** Realistic export samples used by the import tests. */
export const FIXTURES = {
  todoist: { name: "Home.csv", text: todoistHome },
  linear: { name: "linear.csv", text: linear },
  notion: { name: "Tasks 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.csv", text: notionTasks },
  semicolon: { name: "semicolon.csv", text: semicolon },
} as const;

/** Thursday 1 October 2026, local time. */
export const TODAY = new Date(2026, 9, 1);
