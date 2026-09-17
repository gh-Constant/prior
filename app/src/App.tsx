import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "./lib/api";
import { clearSession, getToken, getUser, isAndroidTauri, listenForAuth, saveUser, startGoogleLogin, startNativeGoogleLogin, type SessionUser } from "./lib/auth";
import { localStore } from "./lib/localStore";
import { QUADRANTS, quadrantFor } from "./lib/priority";
import { connectRealtime } from "./lib/realtime";
import type { Area, Habit, HabitDraft, NoteDraft, NoteFolderDraft, Project, ProjectStatus, Task, TaskDraft } from "./types";
import { Icon } from "./components/Icon";
import { Quadrant } from "./components/Quadrant";
import { TaskComposer } from "./components/TaskComposer";
import { CompletionExitProvider, TaskRow } from "./components/TaskRow";
import { TaskColumns } from "./components/TaskColumns";
import { AccountDialog } from "./components/AccountDialog";
import { updateAndroidWidget } from "./lib/widget";
import { defaultTaskFilters, type TaskFilterState } from "./lib/taskFilters";
import { TaskFilters } from "./components/TaskFilters";
import { AgentSidebar } from "./components/AgentSidebar";
import { HabitComposer } from "./components/HabitComposer";
import { HabitView } from "./components/HabitView";
import { CompletionBurst } from "./components/CompletionBurst";
import { filterTasksWithExitingCompletions, useCompletionExits } from "./lib/completionExit";
import { AppSidebar, type WorkspaceView } from "./components/AppSidebar";
import { MobileTopBar } from "./components/MobileTopBar";
import { pullAssistantSettings } from "./lib/settingsSync";
import { SettingsPage } from "./components/SettingsPage";
import { NotesWorkspace } from "./components/NotesWorkspace";
import { notesStore } from "./lib/notes";
import { workspaceSync } from "./lib/workspaceSync";
import { workspaceStore } from "./lib/workspaceStore";
import { WorkHubView, type WorkHubViewKind } from "./components/WorkHubView";

type Layout = "list" | "board";

function viewTitle(view: WorkspaceView): string {
  if (view === "today") return "Today";
  if (view === "inbox") return "Inbox";
  if (view === "projects") return "Projects";
  if (view === "project") return "Project";
  if (view === "waiting") return "Waiting";
  if (view === "eisenhower") return "Eisenhower";
  if (view === "habits") return "Habits";
  if (view === "notes") return "Notes";
  if (view === "settings") return "Settings";
  return "All tasks";
}

type WorkspaceHeaderProps = {
  readonly activeView: WorkspaceView;
  readonly layout: Layout;
  readonly onLayoutChange: (layout: Layout) => void;
  readonly shortcut: string;
  readonly shortcutKey: string;
  readonly onNewTask: () => void;
};

function WorkspaceHeader({ activeView, layout, onLayoutChange, shortcut, shortcutKey, onNewTask }: WorkspaceHeaderProps) {
  if (["today", "inbox", "projects", "project", "waiting", "notes", "settings"].includes(activeView)) return null;
  const creatingHabit = activeView === "habits";
  const newTaskLabel = creatingHabit ? "New habit" : "New task";
  return (
    <header className="workspace-header">
      <h1>{viewTitle(activeView)}</h1>
      <div className="workspace-actions">
        {activeView === "all" && <div className="layout-switch" role="toolbar" aria-label="Task layout">
          <button type="button" className={layout === "list" ? "active" : ""} aria-label="List view" aria-pressed={layout === "list"} onClick={() => onLayoutChange("list")}><Icon name="list" /></button>
          <button type="button" className={layout === "board" ? "active" : ""} aria-label="Column view" title="Column view" aria-pressed={layout === "board"} onClick={() => onLayoutChange("board")}><Icon name="columns" /></button>
        </div>}
        <button className="primary-button new-task-button" type="button" aria-label={newTaskLabel} title={`${newTaskLabel} (${shortcut})`} aria-keyshortcuts={shortcutKey} onClick={onNewTask}><Icon name="plus" /><span>{newTaskLabel}</span><kbd>{shortcut}</kbd></button>
      </div>
    </header>
  );
}

type WorkspaceContentProps = {
  readonly activeView: WorkspaceView;
  readonly user: SessionUser | null;
  readonly onUserUpdated: (user: SessionUser) => void;
  readonly layout: Layout;
  readonly grouped: Record<string, Task[]>;
  readonly tasks: Task[];
  readonly visibleTasks: Task[];
  readonly habits: Habit[];
  readonly onHabitAdd: () => void;
  readonly onHabitComplete: (habit: Habit, date: string) => Promise<void>;
  readonly onHabitChange: (habit: Habit) => Promise<void>;
  readonly onHabitDelete: (habit: Habit) => Promise<void>;
  readonly onHabitEdit: (habit: Habit) => void;
  readonly onTaskChange: (task: Task) => Promise<void>;
  readonly onTaskDelete: (task: Task) => Promise<void>;
  readonly onTaskEdit: (task: Task) => void;
  readonly areas: Area[];
  readonly projects: Project[];
  readonly selectedProjectId: string | null;
  readonly notesProjectId: string | null;
  readonly onOpenProject: (projectId: string) => void;
  readonly onOpenNotes: (projectId?: string) => void;
  readonly onOpenWaiting: () => void;
  readonly onNewTask: (context?: Pick<TaskDraft, "areaId" | "projectId" | "status">) => void;
  readonly onWorkspaceChange: () => void;
};

function WorkspaceContent({ activeView, user, onUserUpdated, layout, grouped, tasks, visibleTasks, habits, onHabitAdd, onHabitComplete, onHabitChange, onHabitDelete, onHabitEdit, onTaskChange, onTaskDelete, onTaskEdit, areas, projects, selectedProjectId, notesProjectId, onOpenProject, onOpenNotes, onOpenWaiting, onNewTask, onWorkspaceChange }: WorkspaceContentProps) {
  if (activeView === "settings") return <SettingsPage user={user} onUserUpdated={onUserUpdated} />;
  if (activeView === "notes") return <NotesWorkspace projectId={notesProjectId ?? undefined} />;
  if (["today", "inbox", "projects", "project", "waiting"].includes(activeView)) return <WorkHubView view={activeView as WorkHubViewKind} tasks={tasks} areas={areas} projects={projects} selectedProjectId={selectedProjectId} onOpenProject={onOpenProject} onOpenNotes={onOpenNotes} onOpenWaiting={onOpenWaiting} onNewTask={onNewTask} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} onWorkspaceChange={onWorkspaceChange} />;
  if (activeView === "habits") {
    return <HabitView habits={habits} onAdd={onHabitAdd} onComplete={onHabitComplete} onChange={onHabitChange} onDelete={onHabitDelete} onEdit={onHabitEdit} />;
  }
  if (activeView === "eisenhower") {
    return (
      <div className="quadrant-grid">
        {QUADRANTS.map((quadrant) => <Quadrant key={quadrant.key} id={quadrant.key} label={quadrant.label} tasks={grouped[quadrant.key] ?? []} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />)}
      </div>
    );
  }
  if (layout === "board") {
    return <TaskColumns tasks={visibleTasks} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />;
  }
  return (
    <section className="list-view" aria-label="All tasks">
      {visibleTasks.map((task) => <TaskRow key={task.id} task={task} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />)}
    </section>
  );
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [areas, setAreas] = useState<Area[]>(() => workspaceStore.listAreas());
  const [projects, setProjects] = useState<Project[]>(() => workspaceStore.listProjects());
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTaskContext, setNewTaskContext] = useState<Pick<TaskDraft, "areaId" | "projectId" | "status"> | undefined>(undefined);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [habitComposerOpen, setHabitComposerOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState<SessionUser | null>(() => getUser());
  const [activeView, setActiveView] = useState<WorkspaceView>("today");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [notesProjectId, setNotesProjectId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("prior.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [taskFilters, setTaskFilters] = useState<TaskFilterState>(defaultTaskFilters);
  const [, bumpRelativeDateTick] = useReducer((value: number) => value + 1, 0);
  const [layout, setLayout] = useState<Layout>("list");
  const [completionCelebration, setCompletionCelebration] = useState<{ title: string; key: number } | null>(null);
  const celebrationKey = useRef(0);
  const syncInFlight = useRef<Promise<void> | null>(null);
  const syncQueued = useRef(false);
  const workspaceSyncTimer = useRef<number | undefined>(undefined);
  const sessionGeneration = useRef(0);
  const realtimeClose = useRef<(() => Promise<void>) | undefined>(undefined);
  const realtimeGeneration = useRef(0);
  const { deadlines: completionExitDeadlines, retain: retainCompletionExit, release: releaseCompletionExit } = useCompletionExits();
  const [agentOpen, setAgentOpen] = useState(() => {
    try {
      return localStorage.getItem("prior.ai.open") === "true";
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ N" : "Ctrl N";
  const shortcutKey = shortcut.startsWith("⌘") ? "Meta+N" : "Control+N";
  const aiShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ J" : "Ctrl J";

  const refreshWorkspace = useCallback(() => {
    workspaceStore.syncNoteCategories();
    setAreas(workspaceStore.listAreas());
    setProjects(workspaceStore.listProjects());
  }, []);

  useEffect(() => {
    let timeout: number | undefined;
    const refreshRelativeDates = () => {
      bumpRelativeDateTick();
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 50);
      timeout = window.setTimeout(refreshRelativeDates, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    };
    const onFocus = () => bumpRelativeDateTick();
    refreshRelativeDates();
    window.addEventListener("focus", onFocus);
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("prior.ai.open", String(agentOpen));
    } catch {
      // ignore
    }
  }, [agentOpen]);

  useEffect(() => {
    try {
      localStorage.setItem("prior.sidebar.collapsed", String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!completionCelebration) return undefined;

    const key = completionCelebration.key;
    const timeout = window.setTimeout(() => {
      setCompletionCelebration((current) => current?.key === key ? null : current);
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [completionCelebration]);

  const refresh = useCallback(async () => {
    const [nextTasks, nextHabits] = await Promise.all([localStore.listTasks(), localStore.listHabits()]);
    setTasks(nextTasks);
    setHabits(nextHabits);
    void updateAndroidWidget(nextTasks, nextHabits).catch(() => undefined);
  }, []);

  const syncNow = useCallback((): Promise<void> => {
    if (syncInFlight.current) {
      syncQueued.current = true;
      return syncInFlight.current;
    }

    const run = (async () => {
      try {
        const generation = sessionGeneration.current;
        const token = await getToken();
        if (!token || generation !== sessionGeneration.current) return;
        // navigator.onLine is unreliable in Tauri webviews. The API request has
        // its own timeout and is the source of truth for connectivity.
        const state = await localStore.getSyncState();
        let highestPushedRevision = state.lastServerRevision;
        const pending = await localStore.pendingMutations();
        if (pending.length) {
          const pushed = await api.push(pending, token);
          if (generation !== sessionGeneration.current) return;
          await localStore.removeMutations(pushed.applied.map((item) => item.mutationId));
          highestPushedRevision = pushed.applied.reduce((value, item) => Math.max(value, item.revision), highestPushedRevision);
        }
        let pulled = await api.pull(state.lastServerRevision, token);
        if (generation !== sessionGeneration.current) return;
        const accountId = getUser()?.id;
        if (accountId && localStore.needsLegacySync(accountId)) {
          const fullHistory = state.lastServerRevision === 0 ? pulled : await api.pull(0, token);
          const legacy = await localStore.legacyMutations(
            accountId,
            new Set(fullHistory.tasks.map((task) => task.id)),
            new Set((fullHistory.habits ?? []).map((habit) => habit.id)),
          );
          for (let offset = 0; offset < legacy.length; offset += 100) {
            const pushedLegacy = await api.push(legacy.slice(offset, offset + 100), token);
            if (generation !== sessionGeneration.current) return;
            await localStore.removeMutations(pushedLegacy.applied.map((item) => item.mutationId));
            highestPushedRevision = pushedLegacy.applied.reduce((value, item) => Math.max(value, item.revision), highestPushedRevision);
          }
          localStore.markLegacySyncComplete(accountId);
          if (legacy.length) pulled = await api.pull(state.lastServerRevision, token);
        }
        await localStore.applyRemoteTasks(pulled.tasks);
        await localStore.applyRemoteHabits(pulled.habits ?? []);
        await workspaceSync.sync(token, () => generation === sessionGeneration.current);
        // A remote merge may not write anything when the local copy is already
        // current. Refresh explicitly so a newly authenticated account cannot
        // keep rendering the previous account's in-memory workspace.
        refreshWorkspace();
        const finalRevision = Math.max(pulled.revision, highestPushedRevision);
        await localStore.setSyncRevision(finalRevision);
        await refresh();
      } catch (error) {
        console.warn("Prior sync failed:", error);
        // Local data remains authoritative until the next successful sync.
      }
    })();
    syncInFlight.current = run;
    void run.finally(() => {
      if (syncInFlight.current === run) syncInFlight.current = null;
      if (syncQueued.current) {
        syncQueued.current = false;
        void syncNow();
      }
    }).catch(() => undefined);
    return run;
  }, [refresh]);

  const scheduleWorkspaceSync = useCallback(() => {
    if (workspaceSync.isApplyingRemote()) return;
    if (workspaceSyncTimer.current !== undefined) window.clearTimeout(workspaceSyncTimer.current);
    workspaceSyncTimer.current = window.setTimeout(() => {
      workspaceSyncTimer.current = undefined;
      void syncNow();
    }, 700);
  }, [syncNow]);

  const attachRealtime = useCallback(async () => {
    const generation = ++realtimeGeneration.current;
    const token = await getToken();
    if (!token || generation !== realtimeGeneration.current) return;
    await realtimeClose.current?.();
    if (generation !== realtimeGeneration.current) return;
    realtimeClose.current = await connectRealtime(token, () => void syncNow());
  }, [syncNow]);

  useEffect(() => {
    void refresh().catch((error) => console.warn("Prior local store failed:", error));
    refreshWorkspace();
    void syncNow();
    void attachRealtime().catch(() => undefined);
    const dispose = listenForAuth((nextUser) => {
      sessionGeneration.current += 1;
      setUser(nextUser);
      setAuthError("");
      setAuthOpen(false);
      refreshWorkspace();
      void refresh().catch((error) => console.warn("Prior could not refresh after sign-in:", error));
      void attachRealtime().catch(() => undefined);
      void syncNow();
      void pullAssistantSettings();
    }, (error) => {
      setAuthError(error.message);
      setAuthOpen(true);
    });
    return () => {
      dispose();
      realtimeGeneration.current += 1;
      const close = realtimeClose.current;
      realtimeClose.current = undefined;
      void close?.();
    };
  }, [attachRealtime, refresh, refreshWorkspace, syncNow]);

  useEffect(() => workspaceStore.subscribe(() => {
    refreshWorkspace();
    scheduleWorkspaceSync();
  }), [refreshWorkspace, scheduleWorkspaceSync]);

  useEffect(() => notesStore.subscribe(scheduleWorkspaceSync), [scheduleWorkspaceSync]);

  useEffect(() => () => {
    if (workspaceSyncTimer.current !== undefined) window.clearTimeout(workspaceSyncTimer.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (activeView === "notes") window.dispatchEvent(new Event("prior-notes-new"));
        else if (activeView === "habits") setHabitComposerOpen(true); else openNewTask();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setAgentOpen((prev) => !prev);
      }
      if (event.key === "Escape") {
        setComposerOpen(false);
        setEditingTask(null);
        setHabitComposerOpen(false);
        setAuthOpen(false);
        setAgentOpen(false);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("online", syncNow);
    window.addEventListener("focus", syncNow);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("online", syncNow); window.removeEventListener("focus", syncNow); };
  }, [activeView, syncNow]);

  function openNewTask(context?: Pick<TaskDraft, "areaId" | "projectId" | "status">): void {
    setNewTaskContext(context);
    setComposerOpen(true);
  }

  async function saveTask(input: TaskDraft) {
    await localStore.saveTask({ ...newTaskContext, ...input });
    setComposerOpen(false);
    setNewTaskContext(undefined);
    await refresh();
    void syncNow();
  }

  async function saveEditedTask(input: TaskDraft) {
    if (!editingTask) return;
    await localStore.updateTask({ ...editingTask, ...input, description: input.description ?? "", dueDate: input.dueDate ?? null, priority: input.priority ?? 4 });
    setEditingTask(null);
    await refresh();
    void syncNow();
  }

  function resolveAgentAreaId(areaName: string | null | undefined): string | null {
    if (!areaName) return null;
    const wanted = areaName.trim().toLowerCase();
    if (!wanted) return null;
    const existing = workspaceStore.listAreas().find((a) => a.name.trim().toLowerCase() === wanted);
    if (existing) return existing.id;
    const created = workspaceStore.createArea(areaName.trim());
    setAreas(workspaceStore.listAreas());
    return created.id;
  }

  function resolveAgentProjectId(projectName: string | null | undefined, areaId: string | null = null): string | null {
    if (!projectName) return null;
    const wanted = projectName.trim().toLowerCase();
    if (!wanted) return null;
    const existing = workspaceStore.listProjects().find((p) => p.name.trim().toLowerCase() === wanted);
    if (existing) {
      if (areaId && !existing.areaId) {
        workspaceStore.updateProject({ ...existing, areaId });
        setProjects(workspaceStore.listProjects());
      }
      return existing.id;
    }
    const created = workspaceStore.createProject(projectName.trim(), areaId);
    setProjects(workspaceStore.listProjects());
    return created.id;
  }

  async function addAgentAreas(batch: Array<{ name: string }>) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const existing = workspaceStore.listAreas().find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
      if (!existing) {
        workspaceStore.createArea(name);
      }
    }
    setAreas(workspaceStore.listAreas());
  }

  async function addAgentProjects(batch: Array<{ name: string; areaName?: string | null; description?: string; status?: ProjectStatus }>) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const areaId = item.areaName ? resolveAgentAreaId(item.areaName) : null;
      const existing = workspaceStore.listProjects().find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      if (!existing) {
        const created = workspaceStore.createProject(name, areaId, item.description ?? "");
        if (item.status && item.status !== "active") {
          workspaceStore.updateProject({ ...created, status: item.status });
        }
      } else if (areaId && !existing.areaId) {
        workspaceStore.updateProject({ ...existing, areaId });
      }
    }
    setAreas(workspaceStore.listAreas());
    setProjects(workspaceStore.listProjects());
  }

  async function addAgentTasks(batch: Array<TaskDraft & { areaName?: string | null; projectName?: string | null }>) {
    for (const item of batch) {
      let areaId = item.areaId ?? null;
      if (!areaId && item.areaName) {
        areaId = resolveAgentAreaId(item.areaName);
      }
      let projectId = item.projectId ?? null;
      if (!projectId && item.projectName) {
        projectId = resolveAgentProjectId(item.projectName, areaId);
      }
      await localStore.saveTask({
        ...item,
        areaId,
        projectId,
      });
    }
    await refresh();
    void syncNow();
  }

  async function addAgentHabits(batch: HabitDraft[]) {
    for (const item of batch) {
      await localStore.saveHabit(item);
    }
    await refresh();
    void syncNow();
  }

  function resolveAgentFolderId(folderName: string | null): string | null {
    if (!folderName) return null;
    const wanted = folderName.trim().toLowerCase();
    if (!wanted) return null;
    const existing = notesStore.listFolders().find((folder) => folder.name.trim().toLowerCase() === wanted);
    if (existing) return existing.id;
    return notesStore.createFolder(folderName.trim()).id;
  }

  async function addAgentFolders(batch: NoteFolderDraft[]) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const wanted = name.toLowerCase();
      const parentWanted = item.parentName?.trim().toLowerCase() ?? null;
      const duplicate = notesStore.listFolders().some((folder) => {
        if (folder.name.trim().toLowerCase() !== wanted) return false;
        if (!parentWanted) return folder.parentId === null;
        const parent = notesStore.listFolders().find((candidate) => candidate.id === folder.parentId);
        return parent?.name.trim().toLowerCase() === parentWanted;
      });
      if (duplicate) continue;
      const parentId = item.parentName ? resolveAgentFolderId(item.parentName) : null;
      notesStore.createFolder(name, parentId);
    }
  }

  async function addAgentNotes(batch: NoteDraft[]) {
    for (const item of batch) {
      const title = item.title.trim() || "Untitled note";
      const folderId = resolveAgentFolderId(item.folderName);
      let projectId: string | null = null;
      if (item.projectName) {
        projectId = resolveAgentProjectId(item.projectName);
      }
      const created = notesStore.create(title, folderId, projectId);
      notesStore.update({ ...created, body: item.bodyMarkdown, favorite: item.favorite });
    }
    setProjects(workspaceStore.listProjects());
  }

  async function changeTask(task: Task) {
    const previous = tasks.find((item) => item.id === task.id);
    const savedTask = await localStore.updateTask(task);
    if (previous && !previous.completed && task.completed) {
      retainCompletionExit(task.id);
      setCompletionCelebration({ title: task.title, key: ++celebrationKey.current });
    } else if (!task.completed) {
      releaseCompletionExit(task.id);
    }
    setTasks((current) => current.map((item) => item.id === savedTask.id ? savedTask : item));
    void refresh();
    void syncNow();
  }

  async function deleteTask(task: Task) {
    await localStore.removeTask(task);
    releaseCompletionExit(task.id);
    await refresh();
    void syncNow();
  }

  async function saveHabit(input: HabitDraft) {
    await localStore.saveHabit(input);
    setHabitComposerOpen(false);
    setEditingHabit(null);
    await refresh();
    void syncNow();
  }

  async function completeHabit(habit: Habit, date: string) {
    const completedDates = habit.completedDates.includes(date)
      ? habit.completedDates.filter((value) => value !== date)
      : [...habit.completedDates, date];
    const savedHabit = await localStore.updateHabit({ ...habit, completedDates });
    if (!habit.completedDates.includes(date)) {
      setCompletionCelebration({ title: habit.title, key: ++celebrationKey.current });
    }
    setHabits((current) => current.map((item) => item.id === savedHabit.id ? savedHabit : item));
    void refresh();
    void syncNow();
  }

  async function changeHabit(habit: Habit) { await localStore.updateHabit(habit); await refresh(); void syncNow(); }
  async function deleteHabit(habit: Habit) { await localStore.removeHabit(habit); await refresh(); void syncNow(); }

  async function logout() {
    const token = await getToken().catch(() => null);
    sessionGeneration.current += 1;
    realtimeGeneration.current += 1;
    const close = realtimeClose.current;
    realtimeClose.current = undefined;
    void close?.();
    // Local logout must not wait for a network round trip. Remote revocation
    // is best-effort and the API client has a short timeout.
    await clearSession().catch((error) => console.warn("Prior could not clear the saved session:", error));
    await localStore.resetSyncRevision().catch((error) => console.warn("Prior could not reset sync state:", error));
    setUser(null);
    setAuthOpen(false);
    refreshWorkspace();
    await refresh().catch((error) => console.warn("Prior could not refresh after sign-out:", error));
    if (token) void api.logout(token).catch(() => undefined);
  }

  const visibleTasks = useMemo(
    () => filterTasksWithExitingCompletions(tasks, taskFilters, completionExitDeadlines),
    [tasks, taskFilters, completionExitDeadlines],
  );

  const grouped = useMemo(() => Object.fromEntries(QUADRANTS.map((quadrant) => [quadrant.key, visibleTasks.filter((task) => quadrantFor(task) === quadrant.key)])), [visibleTasks]);

  function handleAuthenticated(nextUser: SessionUser) {
    sessionGeneration.current += 1;
    setUser(nextUser);
    setAuthError("");
    setAuthOpen(false);
    refreshWorkspace();
    void refresh().catch((error) => console.warn("Prior could not refresh after sign-in:", error));
    void attachRealtime().catch(() => undefined);
    void syncNow();
    void pullAssistantSettings();
  }

  function handleUserUpdated(nextUser: SessionUser): void {
    saveUser(nextUser);
    setUser(nextUser);
  }

  function openProject(projectId: string): void {
    if (!projectId) {
      setSelectedProjectId(null);
      setActiveView("projects");
      return;
    }
    setSelectedProjectId(projectId);
    setActiveView("project");
  }

  function openNotes(projectId?: string): void {
    setNotesProjectId(projectId ?? null);
    setActiveView("notes");
  }

  function openWaiting(): void {
    setActiveView("waiting");
  }

  function changeView(view: WorkspaceView): void {
    if (view !== "project") setSelectedProjectId(null);
    if (view === "notes") setNotesProjectId(null);
    setMobileNavOpen(false);
    setActiveView(view);
  }

  async function googleLogin() {
    setAuthError("");
    try {
      // On Android, prefer the system account picker; fall back to the
      // browser OAuth flow when native sign-in is unavailable.
      if (isAndroidTauri()) {
        try {
          const nativeUser = await startNativeGoogleLogin();
          if (nativeUser) {
            handleAuthenticated(nativeUser);
            return;
          }
          // Dismissed picker: stay on the account screen, no error.
          if (nativeUser === null) return;
        } catch {
          console.warn("Prior native Google sign-in unavailable, falling back to browser.");
        }
      }
      await startGoogleLogin();
      setAuthOpen(false);
    } catch {
      console.warn("Prior could not open Google sign-in.");
      setAuthError("Unable to open Google sign-in. Please try again.");
      setAuthOpen(true);
    }
  }

  return (
    <div className={`app-shell ${agentOpen ? "agent-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <AppSidebar
        activeView={activeView}
        user={user}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        agentOpen={agentOpen}
        aiShortcut={aiShortcut}
        inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen}
        onViewChange={changeView}
        onAccount={() => setAuthOpen(true)}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onToggleAgent={() => setAgentOpen((value) => !value)}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <main className={`workspace ${activeView === "notes" ? "notes-workspace-page" : ""}`} inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen}>
        <MobileTopBar
          activeView={activeView}
          projectName={projects.find((project) => project.id === selectedProjectId)?.name}
          menuOpen={mobileNavOpen}
          onMenu={() => setMobileNavOpen((value) => !value)}
        />
        <WorkspaceHeader
          activeView={activeView}
          layout={layout}
          onLayoutChange={setLayout}
          shortcut={shortcut}
          shortcutKey={shortcutKey}
          onNewTask={() => activeView === "habits" ? setHabitComposerOpen(true) : openNewTask()}
        />

        {(activeView === "all" || activeView === "eisenhower") && <TaskFilters value={taskFilters} onChange={setTaskFilters} />}

        <CompletionExitProvider deadlines={completionExitDeadlines}>
          <WorkspaceContent
            activeView={activeView}
            user={user}
            onUserUpdated={handleUserUpdated}
            layout={layout}
            grouped={grouped}
            tasks={tasks}
            visibleTasks={visibleTasks}
            habits={habits}
            onHabitAdd={() => setHabitComposerOpen(true)}
            onHabitComplete={completeHabit}
            onHabitChange={changeHabit}
            onHabitDelete={deleteHabit}
            onHabitEdit={(habit) => { setEditingHabit(habit); setHabitComposerOpen(true); }}
            onTaskChange={changeTask}
            onTaskDelete={deleteTask}
            onTaskEdit={(task) => setEditingTask(task)}
            areas={areas}
            projects={projects}
            selectedProjectId={selectedProjectId}
            notesProjectId={notesProjectId}
            onOpenProject={openProject}
            onOpenNotes={openNotes}
            onOpenWaiting={openWaiting}
            onNewTask={openNewTask}
            onWorkspaceChange={refreshWorkspace}
          />
        </CompletionExitProvider>
        {visibleTasks.length === 0 && activeView === "all" && <button className="empty-add" type="button" onClick={() => setComposerOpen(true)}><Icon name="plus" /> New task</button>}
      </main>

      <AgentSidebar
        open={agentOpen}
        inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen}
        onClose={() => setAgentOpen(false)}
        tasks={tasks}
        habits={habits}
        areas={areas}
        projects={projects}
        user={user}
        onAddTasks={addAgentTasks}
        onAddHabits={addAgentHabits}
        onAddNotes={addAgentNotes}
        onAddFolders={addAgentFolders}
        onAddAreas={addAgentAreas}
        onAddProjects={addAgentProjects}
        onOpenSettings={() => { setAgentOpen(false); changeView("settings"); }}
      />

      {(composerOpen || editingTask) && <TaskComposer task={editingTask ?? undefined} areas={areas} projects={projects} initialContext={newTaskContext} onSave={editingTask ? saveEditedTask : saveTask} onCancel={() => { setComposerOpen(false); setEditingTask(null); setNewTaskContext(undefined); }} />}
      {habitComposerOpen && <HabitComposer habit={editingHabit ?? undefined} onSave={saveHabit} onCancel={() => { setHabitComposerOpen(false); setEditingHabit(null); }} />}
      {authOpen && <AccountDialog user={user} authError={authError} onClose={() => { setAuthOpen(false); setAuthError(""); }} onAuthenticated={handleAuthenticated} onGoogle={() => { void googleLogin(); }} onLogout={logout} onSettings={() => { setAuthOpen(false); setAuthError(""); changeView("settings"); }} />}
      {completionCelebration && <div className="completion-celebration" role="status" aria-live="polite"><span className="completion-celebration-icon"><Icon name="check" /><CompletionBurst trigger={completionCelebration.key} /></span><span><strong>Completed</strong><small>{completionCelebration.title}</small></span></div>}
    </div>
  );
}
