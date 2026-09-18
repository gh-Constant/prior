import type { Area, Project, ProjectCycle, Task, TaskDraft } from "../types";
import { getAccountId } from "./accountScope";
import { localStore } from "./localStore";
import { workspaceStore } from "./workspaceStore";

export const DEV_SEED_ID_PREFIX = "dev-seed-";

/** Tiny inline SVG used to exercise the WorkspaceIcon image branch without network. */
export const DEMO_IMAGE_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='14' fill='#6b8fb3'/><text x='32' y='43' font-family='sans-serif' font-size='32' text-anchor='middle' fill='white'>G</text></svg>",
)}`;

/** Demo person avatar (data URL so it renders offline). */
export const DEMO_AVATAR_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='32' fill='#7c9b70'/><text x='32' y='43' font-family='sans-serif' font-size='28' text-anchor='middle' fill='white'>DY</text></svg>",
)}`;

export type DevSeedPerson = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
};

export type DevSeedSnapshot = {
  areas: Area[];
  projects: Project[];
  /** Fixed-id task inputs. Persisted via localStore.saveTask (SQLite + localStorage). */
  tasks: Array<TaskDraft & { id: string; completed?: boolean }>;
  people: DevSeedPerson[];
  cycles: ProjectCycle[];
};

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

export function isDevSeedId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(DEV_SEED_ID_PREFIX);
}

/** DEV-only gate. Pass an explicit override in tests; otherwise reads import.meta.env.DEV. */
export function isDevEnvironment(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  try {
    const env = (import.meta as unknown as { env?: { DEV?: unknown } }).env;
    return env?.DEV === true;
  } catch {
    return false;
  }
}

/**
 * Pure builder: deterministic fixed ids (prefix dev-seed-) so re-seeding
 * upserts instead of duplicating. Dates are relative to baseDate (default now)
 * so Today/due states always render in local dev.
 */
export function buildDevSeed(baseDate = new Date()): DevSeedSnapshot {
  const nowIso = new Date().toISOString();
  const today = toDateKey(baseDate);
  const tomorrow = toDateKey(addDays(baseDate, 1));
  const nextWeek = toDateKey(addDays(baseDate, 7));
  const lastWeek = toDateKey(addDays(baseDate, -7));

  const areas: Area[] = [
    {
      id: `${DEV_SEED_ID_PREFIX}area-work`,
      name: "Work",
      color: "#6b8fb3",
      icon: "briefcase",
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}area-personal`,
      name: "Personal",
      color: "#7c9b70",
      icon: "home",
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
  ];

  const people: DevSeedPerson[] = [
    { id: `${DEV_SEED_ID_PREFIX}person-you`, name: "Demo You", email: "you@example.com", avatarUrl: DEMO_AVATAR_URL },
    { id: `${DEV_SEED_ID_PREFIX}person-alex`, name: "Alex Rivera", email: "alex@example.com", avatarUrl: "https://example.com/avatar-alex.png" },
  ];

  const cycles: ProjectCycle[] = [
    {
      id: `${DEV_SEED_ID_PREFIX}cycle-sprint-1`,
      name: "Sprint 1",
      startsOn: lastWeek,
      endsOn: nextWeek,
      issueIds: [`${DEV_SEED_ID_PREFIX}task-next-pricing`, `${DEV_SEED_ID_PREFIX}task-progress-nav`],
    },
  ];

  const projects: Project[] = [
    {
      id: `${DEV_SEED_ID_PREFIX}project-website`,
      areaId: `${DEV_SEED_ID_PREFIX}area-work`,
      name: "Launch website",
      description: "Demo board project: every workflow column has an issue except Waiting.",
      icon: "rocket",
      status: "active",
      health: "On track",
      startDate: lastWeek,
      targetDate: nextWeek,
      cycles,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}project-app`,
      areaId: `${DEV_SEED_ID_PREFIX}area-work`,
      name: "Mobile app",
      description: "Second demo project using the code icon.",
      icon: "code",
      status: "active",
      health: "At risk",
      startDate: today,
      targetDate: nextWeek,
      cycles: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}project-exam`,
      areaId: `${DEV_SEED_ID_PREFIX}area-personal`,
      name: "Exam prep",
      description: "Waiting + assigned demo work lives here.",
      icon: "target",
      status: "planned",
      health: null,
      startDate: null,
      targetDate: nextWeek,
      cycles: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      // Intentionally empty: demonstrates "No issues yet" / "No tasks in this
      // project" and exercises the WorkspaceIcon image branch.
      id: `${DEV_SEED_ID_PREFIX}project-garden`,
      areaId: null,
      name: "Garden ideas",
      description: "Empty demo project with an uploaded-look image icon.",
      icon: DEMO_IMAGE_ICON,
      status: "active",
      health: null,
      startDate: null,
      targetDate: null,
      cycles: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
  ];

  const websiteId = `${DEV_SEED_ID_PREFIX}project-website`;
  const appId = `${DEV_SEED_ID_PREFIX}project-app`;
  const examId = `${DEV_SEED_ID_PREFIX}project-exam`;
  const workId = `${DEV_SEED_ID_PREFIX}area-work`;
  const personalId = `${DEV_SEED_ID_PREFIX}area-personal`;
  const youId = `${DEV_SEED_ID_PREFIX}person-you`;

  const tasks: DevSeedSnapshot["tasks"] = [
    {
      id: `${DEV_SEED_ID_PREFIX}task-inbox-capture`,
      title: "Capture invoice photo",
      description: "Inbox item without a project.",
      priority: 4,
      important: false,
      urgent: false,
      status: "inbox",
      areaId: null,
      projectId: null,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-triage-footer`,
      title: "Triage: new footer request",
      description: "Board Triage column (1 issue).",
      priority: 3,
      important: false,
      urgent: false,
      status: "inbox",
      areaId: workId,
      projectId: websiteId,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-backlog-dark`,
      title: "Add dark mode",
      description: "Board Backlog column.",
      priority: 3,
      important: false,
      urgent: false,
      status: "backlog",
      areaId: workId,
      projectId: websiteId,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-backlog-analytics`,
      title: "Wire launch analytics",
      description: "Board Backlog column (2 issues).",
      priority: 4,
      important: false,
      urgent: false,
      status: "backlog",
      areaId: workId,
      projectId: websiteId,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-next-pricing`,
      title: "Build pricing section",
      description: "Due today and assigned to me.",
      priority: 1,
      important: true,
      urgent: true,
      status: "next",
      dueDate: today,
      scheduledDate: today,
      areaId: workId,
      projectId: websiteId,
      assigneeName: "Me",
      peopleIds: [youId],
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-next-announce`,
      title: "Write launch announcement",
      description: "Board Todo column (2 issues), due tomorrow.",
      priority: 2,
      important: true,
      urgent: false,
      status: "next",
      dueDate: tomorrow,
      areaId: workId,
      projectId: websiteId,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-progress-nav`,
      title: "Fix mobile navigation",
      description: "Board In progress column (1 issue).",
      priority: 1,
      important: true,
      urgent: false,
      status: "in_progress",
      areaId: workId,
      projectId: websiteId,
    },
    {
      // Website intentionally has no "waiting" issue so the board shows
      // "No issues in this state." in that column.
      id: `${DEV_SEED_ID_PREFIX}task-done-beta`,
      title: "Ship private beta",
      description: "Board Done column (1 completed issue).",
      priority: 2,
      important: false,
      urgent: false,
      status: "done",
      completed: true,
      areaId: workId,
      projectId: websiteId,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-app-onboarding`,
      title: "Design onboarding flow",
      description: "Task in a second project.",
      priority: 2,
      important: true,
      urgent: false,
      status: "next",
      dueDate: nextWeek,
      areaId: workId,
      projectId: appId,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-waiting-brief`,
      title: "Send brief to Alex",
      description: "Waiting + delegated demo work.",
      priority: 3,
      important: false,
      urgent: false,
      status: "waiting",
      assigneeName: "Alex Rivera",
      followUpDate: tomorrow,
      areaId: personalId,
      projectId: examId,
    },
    {
      id: `${DEV_SEED_ID_PREFIX}task-personal-dentist`,
      title: "Book dentist appointment",
      description: "Due today without a project.",
      priority: 2,
      important: false,
      urgent: true,
      status: "next",
      dueDate: today,
      areaId: personalId,
      projectId: null,
    },
  ];

  return { areas, projects, tasks, people, cycles };
}

// Module-level exports for convenient imports (built relative to today).
const defaultSeed = buildDevSeed();
export const seedAreas: Area[] = defaultSeed.areas;
export const seedProjects: Project[] = defaultSeed.projects;
export const seedTasks: DevSeedSnapshot["tasks"] = defaultSeed.tasks;
export const seedPeople: DevSeedPerson[] = defaultSeed.people;
export const seedCycles: ProjectCycle[] = defaultSeed.cycles;
/** Board issues = seeded tasks attached to the demo board project. */
export const seedIssues: DevSeedSnapshot["tasks"] = defaultSeed.tasks.filter(
  (task) => task.projectId === `${DEV_SEED_ID_PREFIX}project-website`,
);

export type SeedResult =
  | { seeded: true; reason: "seeded"; tasks: number; projects: number; areas: number }
  | { seeded: false; reason: "not-dev" | "signed-in" | "non-empty" };

export type SeedOptions = {
  dev?: boolean;
  /** Force upsert of seed ids even when user data exists. Never deletes non-seed data. */
  force?: boolean;
  /** Default true unless force: only auto-seed the anonymous local account. */
  requireAnonymous?: boolean;
  baseDate?: Date;
};

/**
 * Seed demo data through the public store APIs (never raw SQL):
 * tasks via localStore.saveTask (works for localStorage + Tauri SQLite),
 * areas/projects via workspaceStore.mergeRemote (idempotent by fixed id).
 * Never overwrites real user data: without force, bails when any store is non-empty.
 */
export async function seedDevDataIfEmpty(options: SeedOptions = {}): Promise<SeedResult> {
  if (!isDevEnvironment(options.dev)) return { seeded: false, reason: "not-dev" };
  const requireAnonymous = options.requireAnonymous ?? !options.force;
  if (requireAnonymous && getAccountId() !== "anonymous") return { seeded: false, reason: "signed-in" };

  const existingTasks = await localStore.listTasks();
  const existingAreas = workspaceStore.listAreas();
  const existingProjects = workspaceStore.listProjects();
  if (!options.force && (existingTasks.length > 0 || existingAreas.length > 0 || existingProjects.length > 0)) {
    return { seeded: false, reason: "non-empty" };
  }

  const snapshot = buildDevSeed(options.baseDate);
  workspaceStore.mergeRemote({ areas: snapshot.areas, projects: snapshot.projects });
  // mergeRemote does not create note folders; the app refresh does, but ensure
  // them here so tests/dev see the same workspace categories.
  workspaceStore.syncNoteCategories();
  for (const task of snapshot.tasks) {
    // Fixed ids make re-runs upserts, never duplicates. Sequential awaits avoid
    // localStorage read-modify-write races.
    await localStore.saveTask(task);
  }
  return { seeded: true, reason: "seeded", tasks: snapshot.tasks.length, projects: snapshot.projects.length, areas: snapshot.areas.length };
}

/** Explicit DEV-only reset: upserts seed ids (restores edits/deletes), preserves non-seed data. */
export async function resetDevDemoData(options: Omit<SeedOptions, "force" | "requireAnonymous"> = {}): Promise<SeedResult> {
  return seedDevDataIfEmpty({ ...options, force: true, requireAnonymous: false });
}

/** DEV-only cleanup used by tests and the Settings dev panel. Removes seed entities only. */
export async function clearDevSeedData(options: { dev?: boolean } = {}): Promise<{ tasks: number; projects: number; areas: number }> {
  if (!isDevEnvironment(options.dev)) return { tasks: 0, projects: 0, areas: 0 };
  const removed = { tasks: 0, projects: 0, areas: 0 };
  const allTasks: Task[] = await localStore.listAllTasks().catch(() => localStore.listTasks());
  for (const task of allTasks.filter((item) => isDevSeedId(item.id) && !item.deletedAt)) {
    await localStore.removeTask(task);
    removed.tasks += 1;
  }
  for (const project of workspaceStore.listProjects().filter((item) => isDevSeedId(item.id))) {
    workspaceStore.removeProject(project);
    removed.projects += 1;
  }
  for (const area of workspaceStore.listAreas().filter((item) => isDevSeedId(item.id))) {
    workspaceStore.removeArea(area);
    removed.areas += 1;
  }
  return removed;
}
