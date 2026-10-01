import type { WorkspaceView } from "../components/AppSidebar";
import type { SettingsTab } from "../components/SettingsPage";

/**
 * Where the user is, mirrored in the address bar so a reload or a shared
 * link opens the same page (Linear-style URLs):
 *
 *   /today · /focus · /inbox · /calendar · /my-tasks · /tasks · /waiting · /matrix · /habits
 *   /projects · /projects/<id> · /projects/<id>/<tab>
 *   /notes · /notes/<projectId> · /progress · /plans · /admin
 *   /settings · /settings/<tab>
 *   …?task=<id> opens a task on top of any page.
 *
 * Paths owned by other flows (/reset-password, /verify-email, /auth/callback,
 * /invite/<token>) are not routes: they parse as the default page.
 */
export type AppRoute = {
  readonly view: WorkspaceView;
  readonly projectId?: string | null;
  /** A project page tab (board, issues, overview, cycles, activity, list, notes, leaderboard). */
  readonly projectTab?: string | null;
  readonly notesProjectId?: string | null;
  readonly settingsTab?: SettingsTab | null;
  readonly taskId?: string | null;
};

const VIEW_PATHS: Partial<Record<WorkspaceView, string>> = {
  today: "today",
  focus: "focus",
  inbox: "inbox",
  calendar: "calendar",
  projects: "projects",
  mine: "my-tasks",
  all: "tasks",
  waiting: "waiting",
  eisenhower: "matrix",
  habits: "habits",
  notes: "notes",
  progress: "progress",
  settings: "settings",
  plans: "plans",
  admin: "admin",
};

const PATH_VIEWS = new Map(Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as WorkspaceView]));

export const PROJECT_TABS = ["board", "issues", "overview", "cycles", "activity", "list", "notes", "leaderboard"] as const;
const SETTINGS_TABS: readonly SettingsTab[] = ["general", "profile", "security", "notifications", "planning", "game", "assistant", "integrations", "import", "diagnostics", "developer"];

/** Ids are UUIDs; anything else in a URL segment is ignored rather than trusted. */
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function segmentId(value: string | undefined): string | null {
  if (!value) return null;
  const decoded = safeDecode(value);
  return ID_PATTERN.test(decoded) ? decoded : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const DEFAULT_ROUTE: AppRoute = { view: "today" };

export function parseRoute(location: Pick<Location, "pathname" | "search">): AppRoute {
  const segments = location.pathname.split("/").filter(Boolean);
  const taskId = segmentId(new URLSearchParams(location.search).get("task") ?? undefined);
  const withTask = (route: AppRoute): AppRoute => (taskId ? { ...route, taskId } : route);
  const [first, second, third] = segments;
  if (!first) return withTask(DEFAULT_ROUTE);
  const view = PATH_VIEWS.get(first);
  if (!view) return DEFAULT_ROUTE;
  if (view === "projects" && second) {
    const projectId = segmentId(second);
    if (!projectId) return withTask({ view: "projects" });
    const tab = third && (PROJECT_TABS as readonly string[]).includes(third) ? third : null;
    return withTask({ view: "project", projectId, projectTab: tab });
  }
  if (view === "notes" && second) return withTask({ view: "notes", notesProjectId: segmentId(second) });
  if (view === "settings" && second) {
    const tab = SETTINGS_TABS.find((candidate) => candidate === second) ?? null;
    return withTask({ view: "settings", settingsTab: tab });
  }
  return withTask({ view });
}

/** The path (and ?task= query) for a route. Always starts with "/". */
export function routeToPath(route: AppRoute): string {
  let path: string;
  if (route.view === "project" && route.projectId) {
    path = `/projects/${encodeURIComponent(route.projectId)}${route.projectTab ? `/${route.projectTab}` : ""}`;
  } else if (route.view === "project") {
    path = "/projects";
  } else if (route.view === "notes" && route.notesProjectId) {
    path = `/notes/${encodeURIComponent(route.notesProjectId)}`;
  } else if (route.view === "settings" && route.settingsTab && route.settingsTab !== "general") {
    path = `/settings/${route.settingsTab}`;
  } else {
    path = `/${VIEW_PATHS[route.view] ?? "today"}`;
  }
  return route.taskId ? `${path}?task=${encodeURIComponent(route.taskId)}` : path;
}

/** Same page, possibly with a different task open. */
export function samePage(left: string, right: string): boolean {
  return left.split("?")[0] === right.split("?")[0];
}

/** The web address of a route, for links shared outside the app. */
export function routeUrl(route: AppRoute, origin: string): string {
  return `${origin.replace(/\/+$/, "")}${routeToPath(route)}`;
}
