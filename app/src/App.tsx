import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "./lib/api";
import { AUTH_REQUIRED_EVENT, clearSession, getToken, getUser, handleAuthError, isAndroidTauri, listenForAuth, saveUser, startGoogleLogin, startNativeGoogleLogin, type SessionUser } from "./lib/auth";
import { useI18n } from "./lib/i18n";
import { localStore } from "./lib/localStore";
import { QUADRANTS, quadrantFor } from "./lib/priority";
import { connectRealtime } from "./lib/realtime";
import { isDesktop } from "./lib/platform";
import { checkForUpdate, installAvailableUpdate, type UpdateInfo } from "./lib/updater";
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
import { collaborationStore } from "./lib/collaborationStore";
import { WorkHubView, type WorkHubViewKind } from "./components/WorkHubView";
import { ProjectEditor } from "./components/collaboration/ProjectEditor";
import { ProjectCycleEditor } from "./components/collaboration/ProjectCycleEditor";
import type { Person, ProjectCollaborationProps, TaskPerson, TaskPlanningProps } from "./components/collaboration/types";

type Layout = "list" | "board";

function viewTitle(view: WorkspaceView, t: (key: string) => string): string {
  if (view === "today") return t("common.views.today");
  if (view === "inbox") return t("common.views.inbox");
  if (view === "projects") return t("common.views.projects");
  if (view === "project") return t("common.views.project");
  if (view === "waiting") return t("common.views.waiting");
  if (view === "eisenhower") return t("common.views.eisenhower");
  if (view === "habits") return t("common.views.habits");
  if (view === "notes") return t("common.views.notes");
  if (view === "settings") return t("common.views.settings");
  return t("common.views.allTasks");
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
  const { t } = useI18n();
  if (["today", "inbox", "projects", "project", "waiting", "notes", "settings"].includes(activeView)) return null;
  const creatingHabit = activeView === "habits";
  const newTaskLabel = creatingHabit ? t("common.header.newHabit") : t("common.header.newTask");
  return (
    <header className="workspace-header">
      <h1>{viewTitle(activeView, t)}</h1>
      <div className="workspace-actions">
        {activeView === "all" && <div className="layout-switch" role="toolbar" aria-label={t("common.header.layout")}>
          <button type="button" className={layout === "list" ? "active" : ""} aria-label={t("common.header.listView")} aria-pressed={layout === "list"} onClick={() => onLayoutChange("list")}><Icon name="list" /></button>
          <button type="button" className={layout === "board" ? "active" : ""} aria-label={t("common.header.columnView")} title={t("common.header.columnView")} aria-pressed={layout === "board"} onClick={() => onLayoutChange("board")}><Icon name="columns" /></button>
        </div>}
        <button className="primary-button new-task-button" type="button" aria-label={newTaskLabel} title={t("common.header.newActionTitle", { label: newTaskLabel, shortcut })} aria-keyshortcuts={shortcutKey} onClick={onNewTask}><Icon name="plus" /><span>{newTaskLabel}</span><kbd>{shortcut}</kbd></button>
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
  readonly collaborationByProject: Readonly<Record<string, Omit<ProjectCollaborationProps, "project">>>;
};
type CollaborationByProject = WorkspaceContentProps["collaborationByProject"];

function WorkspaceContent({ activeView, user, onUserUpdated, layout, grouped, tasks, visibleTasks, habits, onHabitAdd, onHabitComplete, onHabitChange, onHabitDelete, onHabitEdit, onTaskChange, onTaskDelete, onTaskEdit, areas, projects, selectedProjectId, notesProjectId, onOpenProject, onOpenNotes, onOpenWaiting, onNewTask, onWorkspaceChange, collaborationByProject }: WorkspaceContentProps) {
  const { t } = useI18n();
  if (activeView === "settings") return <SettingsPage user={user} onUserUpdated={onUserUpdated} />;
  if (activeView === "notes") return <NotesWorkspace projectId={notesProjectId ?? undefined} />;
  if (["today", "inbox", "projects", "project", "waiting"].includes(activeView)) return <WorkHubView view={activeView as WorkHubViewKind} tasks={tasks} areas={areas} projects={projects} selectedProjectId={selectedProjectId} onOpenProject={onOpenProject} onOpenNotes={onOpenNotes} onOpenWaiting={onOpenWaiting} onNewTask={onNewTask} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} onWorkspaceChange={onWorkspaceChange} collaborationByProject={collaborationByProject} />;
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
    <section className="list-view" aria-label={t("common.views.allTasks")}>
      {visibleTasks.map((task) => <TaskRow key={task.id} task={task} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />)}
    </section>
  );
}

export function App() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [areas, setAreas] = useState<Area[]>(() => workspaceStore.listAreas());
  const [projects, setProjects] = useState<Project[]>(() => workspaceStore.listProjects());
  const [, bumpCollaboration] = useReducer((value: number) => value + 1, 0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTaskContext, setNewTaskContext] = useState<Pick<TaskDraft, "areaId" | "projectId" | "status"> | undefined>(undefined);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [composerProjectId, setComposerProjectId] = useState<string | null | undefined>(undefined);
  const [projectEditor, setProjectEditor] = useState<Project | null>(null);
  const [cycleEditor, setCycleEditor] = useState<{ projectId: string; cycleId?: string } | null>(null);
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
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const workspaceSyncTimer = useRef<number | undefined>(undefined);
  const workspaceSyncFirstQueuedAt = useRef<number | undefined>(undefined);
  const sessionGeneration = useRef(0);
  const realtimeClose = useRef<(() => Promise<void>) | undefined>(undefined);
  const realtimeGeneration = useRef(0);
  const [desktopUpdate, setDesktopUpdate] = useState<UpdateInfo | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
    const personalProjects = workspaceStore.listProjects();
    const personalIds = new Set(personalProjects.map((project) => project.id));
    setProjects([...personalProjects, ...collaborationStore.listProjects().filter((project) => !personalIds.has(project.id))]);
    bumpCollaboration();
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
    if (refreshInFlight.current) return refreshInFlight.current;
    const run = (async () => {
      const [nextTasks, nextHabits] = await Promise.all([localStore.listTasks(), localStore.listHabits()]);
      const accessibleProjectIds = new Set([...workspaceStore.listProjects(), ...collaborationStore.listProjects()].map((project) => project.id));
      setTasks(nextTasks.filter((task) => !task.projectId || accessibleProjectIds.has(task.projectId)));
      setHabits(nextHabits);
      void updateAndroidWidget(nextTasks, nextHabits).catch(() => undefined);
    })();
    refreshInFlight.current = run;
    try {
      await run;
    } finally {
      if (refreshInFlight.current === run) refreshInFlight.current = null;
    }
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
        // Profile first: the server copy wins so a rename on another device
        // converges locally. Failures are non-fatal for task data.
        try {
          const profile = await api.getProfile(token);
          if (generation !== sessionGeneration.current) return;
          const currentUser = getUser();
          if (!currentUser || currentUser.displayName !== profile.displayName || currentUser.email !== profile.email || currentUser.avatarUrl !== profile.avatarUrl) {
            saveUser(profile);
            setUser(profile);
          }
        } catch (profileError) {
          if (await handleAuthError(profileError)) {
            if (generation !== sessionGeneration.current) return;
            setUser(null);
            setAuthError(profileError instanceof Error ? profileError.message : t("common.session.expired"));
            setAuthOpen(true);
            setToast(t("common.toasts.sessionExpired"));
            return;
          }
          console.warn("Prior profile sync failed:", profileError);
        }
        // navigator.onLine is unreliable in Tauri webviews. The API request has
        // its own timeout and is the source of truth for connectivity.
        const state = await localStore.getSyncState();
        let highestPushedRevision = state.lastServerRevision;
        const pending = await localStore.pendingMutations();
        // Server push batches are capped at 100 mutations; chunk client-side.
        for (let offset = 0; offset < pending.length; offset += 100) {
          const chunk = pending.slice(offset, offset + 100);
          const pushed = await api.push(chunk, token);
          if (generation !== sessionGeneration.current) return;
          await localStore.removeMutations(pushed.applied.map((item) => item.mutationId));
          highestPushedRevision = pushed.applied.reduce((value, item) => Math.max(value, item.revision), highestPushedRevision);
        }
        // Paged pull: server caps a single response at PullPageSize (200
        // revisions). Follow nextSince/hasMore so large histories converge.
        async function pullAll(since: number) {
          const first = await api.pull(since, token as string);
          if (generation !== sessionGeneration.current) return first;
          let combined = first;
          let guard = 0;
          while (combined.hasMore && typeof combined.nextSince === "number" && guard < 50) {
            guard += 1;
            const cursor: number = combined.nextSince;
            const next = await api.pull(cursor, token as string);
            if (generation !== sessionGeneration.current) return combined;
            combined = {
              ...next,
              tasks: [...combined.tasks, ...next.tasks],
              habits: [...(combined.habits ?? []), ...(next.habits ?? [])],
            };
          }
          return combined;
        }
        let pulled = await pullAll(state.lastServerRevision);
        if (generation !== sessionGeneration.current) return;
        const accountId = getUser()?.id;
        if (accountId && localStore.needsLegacySync(accountId)) {
          const fullHistory = state.lastServerRevision === 0 ? pulled : await pullAll(0);
          if (generation !== sessionGeneration.current) return;
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
          if (legacy.length) {
            pulled = await pullAll(state.lastServerRevision);
            if (generation !== sessionGeneration.current) return;
          }
        }
        // Snapshot pending ids once per sync so remote merges skip exactly the
        // edits that were still queued when this sync started.
        const pendingSnapshot = await localStore.pendingIdsSnapshot();
        await localStore.applyRemoteTasks(pulled.tasks, pendingSnapshot.tasks);
        await localStore.applyRemoteHabits(pulled.habits ?? [], pendingSnapshot.habits);
        await workspaceSync.sync(token, () => generation === sessionGeneration.current);
        if (generation !== sessionGeneration.current) return;
        let collaborationChanged = false;
        try {
          collaborationChanged = (await collaborationStore.sync(token)).changed;
        } catch (collaborationError) {
          // The cache remains usable when the collaboration endpoint is not
          // deployed yet or the account has no shared projects.
          console.warn("Prior collaboration sync failed:", collaborationError);
        }
        const inviteToken = typeof window !== "undefined" ? new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite") : null;
        if (inviteToken) {
          try {
            await api.acceptProjectInvite(inviteToken, token);
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
            collaborationChanged = (await collaborationStore.sync(token)).changed || collaborationChanged;
            setToast(t("common.toasts.inviteAccepted"));
          } catch (inviteError) {
            console.warn("Prior project invite could not be accepted:", inviteError);
          }
        }
        // A newly accepted/shared project may contain task revisions older than
        // this account's normal sync cursor. Pull the authorized history once
        // when the project ACL changes so the member sees the existing work.
        if (collaborationChanged) {
          const collaborationHistory = await pullAll(0);
          if (generation !== sessionGeneration.current) return;
          await localStore.applyRemoteTasks(collaborationHistory.tasks, pendingSnapshot.tasks);
          pulled = { ...pulled, revision: Math.max(pulled.revision, collaborationHistory.revision) };
        }
        // Assistant settings follow the account after workspace data.
        try {
          const settingsOk = await pullAssistantSettings();
          if (!settingsOk) console.warn("Prior assistant settings not yet synced; will retry on the next sync.");
        } catch (settingsError) {
          if (await handleAuthError(settingsError)) {
            if (generation !== sessionGeneration.current) return;
            setUser(null);
            setAuthError(settingsError instanceof Error ? settingsError.message : t("common.session.expired"));
            setAuthOpen(true);
            setToast(t("common.toasts.sessionExpired"));
            return;
          }
          console.warn("Prior assistant settings sync failed:", settingsError);
        }
        // A remote merge may not write anything when the local copy is already
        // current. Refresh explicitly so a newly authenticated account cannot
        // keep rendering the previous account's in-memory workspace.
        refreshWorkspace();
        const finalRevision = Math.max(pulled.revision, highestPushedRevision);
        await localStore.setSyncRevision(finalRevision);
        await refresh();
      } catch (error) {
        if (await handleAuthError(error)) {
          setUser(null);
          setAuthError(error instanceof Error ? error.message : t("common.session.expired"));
          setAuthOpen(true);
          setToast(t("common.toasts.sessionExpired"));
          return;
        }
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
    const nowMs = Date.now();
    if (workspaceSyncTimer.current !== undefined) window.clearTimeout(workspaceSyncTimer.current);
    if (workspaceSyncFirstQueuedAt.current === undefined) workspaceSyncFirstQueuedAt.current = nowMs;
    const elapsed = nowMs - (workspaceSyncFirstQueuedAt.current ?? nowMs);
    // Single scheduler: debounce 500ms with a 5s maxWait so rapid edits batch
    // but a sustained burst cannot starve the sync indefinitely.
    if (elapsed >= 5000) {
      workspaceSyncFirstQueuedAt.current = undefined;
      workspaceSyncTimer.current = undefined;
      void syncNow();
      return;
    }
    workspaceSyncTimer.current = window.setTimeout(() => {
      workspaceSyncTimer.current = undefined;
      workspaceSyncFirstQueuedAt.current = undefined;
      void syncNow();
    }, 500);
  }, [syncNow]);

  const attachRealtime = useCallback(async () => {
    const generation = ++realtimeGeneration.current;
    const token = await getToken().catch((error) => {
      console.warn("Prior realtime could not read the session token:", error);
      return null;
    });
    if (!token || generation !== realtimeGeneration.current) return;
    try {
      await realtimeClose.current?.();
    } catch (error) {
      console.warn("Prior realtime cleanup failed:", error);
    }
    if (generation !== realtimeGeneration.current) return;
    try {
      realtimeClose.current = await connectRealtime(
        token,
        () => void syncNow(),
        { getRevision: async () => (await localStore.getSyncState()).lastServerRevision },
      );
    } catch (error) {
      console.warn("Prior realtime attach failed; retrying on next trigger:", error);
      if (generation === realtimeGeneration.current) {
        window.setTimeout(() => {
          if (generation === realtimeGeneration.current) void attachRealtime().catch((retryError) => console.warn("Prior realtime retry failed:", retryError));
        }, 5000);
      }
    }
  }, [syncNow]);

  useEffect(() => {
    void refresh().catch((error) => console.warn("Prior local store failed:", error));
    refreshWorkspace();
    void syncNow();
    void attachRealtime().catch((error) => console.warn("Prior realtime attach failed:", error));
    const dispose = listenForAuth((nextUser) => {
      sessionGeneration.current += 1;
      setUser(nextUser);
      setAuthError("");
      setAuthOpen(false);
      refreshWorkspace();
      void refresh().catch((error) => console.warn("Prior could not refresh after sign-in:", error));
      void attachRealtime().catch((error) => console.warn("Prior realtime attach failed:", error));
      void syncNow();
      void pullAssistantSettings().catch((error) => console.warn("Prior assistant settings pull failed:", error));
    }, (error) => {
      setAuthError(error.message);
      setAuthOpen(true);
    });
    return () => {
      dispose();
      realtimeGeneration.current += 1;
      const close = realtimeClose.current;
      realtimeClose.current = undefined;
      void close?.().catch((error) => console.warn("Prior realtime cleanup failed:", error));
    };
  }, [attachRealtime, refresh, refreshWorkspace, syncNow]);

  useEffect(() => {
    // Local dev seed (Workstream 6): DEV-only, anonymous account, empty
    // stores only. Never runs in prod and never overwrites real user data.
    // Dynamic import keeps the seed out of the production bundle.
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    void (async () => {
      try {
        const { seedDevDataIfEmpty } = await import("./lib/devSeed");
        const result = await seedDevDataIfEmpty();
        if (!cancelled && result.seeded) {
          refreshWorkspace();
          await refresh();
        }
      } catch (error) {
        console.warn("Prior dev seed failed:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh, refreshWorkspace]);

  useEffect(() => workspaceStore.subscribe(() => {
    refreshWorkspace();
    scheduleWorkspaceSync();
  }), [refreshWorkspace, scheduleWorkspaceSync]);

  useEffect(() => collaborationStore.subscribe(refreshWorkspace), [refreshWorkspace]);

  useEffect(() => notesStore.subscribe(scheduleWorkspaceSync), [scheduleWorkspaceSync]);

  useEffect(() => {
    const onAuthChange = () => {
      refreshWorkspace();
      void refresh().catch((error) => console.warn("Prior could not refresh on auth change:", error));
    };
    const onAuthRequired = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message ?? t("common.session.expired");
      setAuthError(message);
      setAuthOpen(true);
      setToast(message);
    };
    window.addEventListener("prior-auth-change", onAuthChange);
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => {
      window.removeEventListener("prior-auth-change", onAuthChange);
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    };
  }, [refresh, refreshWorkspace]);

  // Desktop updater: idle check 5s after startup, then daily. The manual
  // button in Settings stays authoritative; this only drives the badge dot.
  useEffect(() => {
    if (!isDesktop()) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        const update = await checkForUpdate();
        if (!cancelled && update) setDesktopUpdate(update);
      } catch (error) {
        console.warn("Prior update check failed:", error);
      }
    };
    const idleTimer = window.setTimeout(() => void check(), 5000);
    const dailyTimer = window.setInterval(() => void check(), 24 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(idleTimer);
      window.clearInterval(dailyTimer);
    };
  }, []);

  // Periodic sync every 60s while visible, plus an immediate sync when the
  // tab becomes visible again.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncNow]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
    setComposerProjectId(context?.projectId ?? null);
    setComposerOpen(true);
  }

  async function saveTask(input: TaskDraft) {
    if (input.projectId && collaborationStore.role(input.projectId) === "viewer") throw new Error(t("common.access.viewOnly"));
    await localStore.saveTask({ ...newTaskContext, ...input, completed: input.status === "done", peopleIds: input.peopleIds ?? (user ? [user.id] : []) });
    setComposerOpen(false);
    setNewTaskContext(undefined);
    await refresh();
    void syncNow();
  }

  async function saveEditedTask(input: TaskDraft) {
    if (!editingTask) return;
    if (editingTask.projectId && collaborationStore.role(editingTask.projectId) === "viewer") throw new Error(t("common.access.viewOnly"));
    await localStore.updateTask({ ...editingTask, ...input, completed: input.status ? input.status === "done" : editingTask.completed, description: input.description ?? "", dueDate: input.dueDate ?? null, priority: input.priority ?? 4 });
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
        refreshWorkspace();
      }
      return existing.id;
    }
    const created = workspaceStore.createProject(projectName.trim(), areaId);
    refreshWorkspace();
    return created.id;
  }

  async function addAgentAreas(batch: Array<{ name: string; color?: string; icon?: string | null }>) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const existing = workspaceStore.listAreas().find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
      if (!existing) {
        workspaceStore.createArea(name, item.color, item.icon);
      }
    }
    setAreas(workspaceStore.listAreas());
  }

  async function addAgentProjects(batch: Array<{ name: string; areaName?: string | null; description?: string; status?: ProjectStatus; targetDate?: string | null; icon?: string | null }>) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const areaId = item.areaName ? resolveAgentAreaId(item.areaName) : null;
      const existing = workspaceStore.listProjects().find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      if (!existing) {
        const created = workspaceStore.createProject(name, areaId, item.description ?? "", item.icon);
        const updates: Partial<Project> = {};
        if (item.status && item.status !== "active") updates.status = item.status;
        if (item.targetDate) updates.targetDate = item.targetDate;
        if (Object.keys(updates).length > 0) {
          workspaceStore.updateProject({ ...created, ...updates });
        }
      } else {
        const updates: Partial<Project> = {};
        if (areaId && !existing.areaId) updates.areaId = areaId;
        if (item.targetDate && !existing.targetDate) updates.targetDate = item.targetDate;
        if (item.icon && !existing.icon) updates.icon = item.icon;
        if (Object.keys(updates).length > 0) {
          workspaceStore.updateProject({ ...existing, ...updates });
        }
      }
    }
    setAreas(workspaceStore.listAreas());
    refreshWorkspace();
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
        peopleIds: item.peopleIds ?? (user ? [user.id] : []),
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
      const title = item.title.trim() || t("common.notes.untitled");
      const folderId = resolveAgentFolderId(item.folderName);
      let projectId: string | null = null;
      if (item.projectName) {
        projectId = resolveAgentProjectId(item.projectName);
      }
      const created = notesStore.create(title, folderId, projectId);
      notesStore.update({ ...created, body: item.bodyMarkdown, favorite: item.favorite });
    }
    refreshWorkspace();
  }

  async function changeTask(task: Task) {
    if (task.projectId && collaborationStore.role(task.projectId) === "viewer") throw new Error(t("common.access.viewOnly"));
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
    if (task.projectId && collaborationStore.role(task.projectId) === "viewer") throw new Error(t("common.access.viewOnly"));
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

  async function saveProjectDetails(project: Project): Promise<void> {
    const entry = collaborationStore.get(project.id);
    if (entry?.role === "viewer") throw new Error(t("common.access.viewOnly"));
    if (entry && entry.role !== "owner") {
      const token = await getToken();
      if (!token) throw new Error(t("common.access.signInToUpdate"));
      await api.updateCollaborativeProject(project.id, project, token);
      await collaborationStore.sync(token);
    } else {
      workspaceStore.updateProject(project);
    }
    refreshWorkspace();
    void syncNow();
  }

  const collaborationByProject = useMemo<CollaborationByProject>(() => {
    const stateOptions = [
      { id: "backlog", name: t("common.states.backlog"), category: "backlog" as const },
      { id: "next", name: t("common.states.todo"), category: "unstarted" as const },
      { id: "in_progress", name: t("common.states.inProgress"), category: "started" as const },
      { id: "waiting", name: t("common.states.waiting"), category: "started" as const },
      { id: "done", name: t("common.states.done"), category: "completed" as const },
    ];
    const result: Record<string, Omit<ProjectCollaborationProps, "project">> = {};
    for (const project of projects) {
      // The collaboration workspace is the default project experience. A
      // server entry enriches it with ACLs and members; local projects still
      // need to render the same workspace before the first authenticated sync.
      const entry = collaborationStore.get(project.id);
      const readOnly = entry?.role === "viewer";
      const members = entry?.members.map((member, index) => {
        const isSelf = member.userId === user?.id;
        const presence = isSelf ? "online" as const : (member.status === "revoked" ? "inactive" as const : (index % 3 === 1 ? "online" as const : index % 3 === 2 ? "away" as const : "inactive" as const));
        return { id: member.userId, name: member.displayName || member.email, email: member.email, avatarUrl: member.avatarUrl, role: member.role, presence };
      }) ?? (user ? [{ id: user.id, name: user.displayName || user.email, email: user.email, avatarUrl: user.avatarUrl, role: "owner" as const, presence: "online" as const }] : []);
      const memberById = new Map(members.map((member) => [member.id, member]));
      const projectIssues = tasks.filter((task) => task.projectId === project.id).map((task) => {
        const rawState = task.completed ? "done" : task.status ?? "backlog";
        return {
        id: task.id,
        title: task.title,
        stateId: rawState === "inbox" ? "backlog" : rawState,
        priority: task.priority,
        people: (task.peopleIds ?? []).map((personId): TaskPerson | null => {
          const person = memberById.get(personId);
          return person ? { id: person.id, name: person.name, email: person.email, avatarUrl: person.avatarUrl, role: personId === task.peopleIds?.[0] ? "owner" : "collaborator", presence: person.presence } : null;
        }).filter((person): person is TaskPerson => Boolean(person)),
        properties: [],
      };
      });
      result[project.id] = {
        issues: projectIssues,
        states: stateOptions,
        cycles: (project.cycles ?? []).map((cycle) => {
          const assigned = projectIssues.filter((issue) => cycle.issueIds?.includes(issue.id));
          const now = new Date();
          const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          return { ...cycle, phase: cycle.endsOn < today ? "past" as const : cycle.startsOn > today ? "upcoming" as const : "current" as const, dateLabel: `${cycle.startsOn} – ${cycle.endsOn}`, issueCount: assigned.length, completedCount: assigned.filter((issue) => issue.stateId === "done").length };
        }),
        readOnly,
        onCreateIssue: readOnly ? undefined : () => openNewTask({ projectId: project.id, status: "backlog" }),
        onEditProject: readOnly ? undefined : () => setProjectEditor(project),
        onCreateCycle: readOnly ? undefined : () => setCycleEditor({ projectId: project.id }),
        onEditCycle: readOnly ? undefined : (cycleId) => setCycleEditor({ projectId: project.id, cycleId }),
        onOpenNotes: () => openNotes(project.id),
        onOpenIssue: (id) => {
          const task = tasks.find((item) => item.id === id && item.projectId === project.id);
          if (task) { setComposerProjectId(task.projectId ?? null); setEditingTask(task); }
        },
        onDeleteIssue: readOnly ? undefined : (id) => {
          const task = tasks.find((item) => item.id === id && item.projectId === project.id);
          if (task) void deleteTask(task);
        },
        onMoveIssue: readOnly ? undefined : async (id, stateId) => {
          const task = tasks.find((item) => item.id === id && item.projectId === project.id);
          if (!task || !stateOptions.some((state) => state.id === stateId)) throw new Error(t("common.errors.moveFailed"));
          await changeTask({ ...task, status: stateId as Task["status"], completed: stateId === "done" });
        },
        sharing: {
          members,
          invites: (entry?.pendingInvites ?? []).map((invite) => ({ id: invite.id, email: invite.email, role: invite.role })),
          canManage: entry?.role === "owner",
          onInvite: (email, role) => {
            void (async () => {
              const token = await getToken();
              if (!token) { setAuthOpen(true); return; }
              try {
                const response = await api.shareProject(project.id, email, role, token);
                await collaborationStore.sync(token);
                refreshWorkspace();
                if (response.invite?.inviteToken) {
                  const inviteLink = `${window.location.origin}${window.location.pathname}#invite=${encodeURIComponent(response.invite.inviteToken)}`;
                  await navigator.clipboard?.writeText(inviteLink);
                  setToast(t("common.toasts.inviteCopied", { email }));
                } else {
                  setToast(t("common.toasts.memberAdded", { email }));
                }
              } catch (error) {
                setToast(error instanceof Error ? error.message : t("common.errors.shareFailed"));
              }
            })();
          },
          onRevokeInvite: (inviteId) => {
            void (async () => {
              const token = await getToken();
              if (!token) return;
              try {
                await api.revokeProjectInvite(project.id, inviteId, token);
                await collaborationStore.sync(token);
                refreshWorkspace();
                setToast(t("common.toasts.inviteRevoked"));
              } catch (error) {
                setToast(error instanceof Error ? error.message : t("common.errors.revokeFailed"));
              }
            })();
          },
          onRoleChange: (userId, role) => {
            void (async () => {
              const token = await getToken();
              if (!token) return;
              try {
                await api.updateProjectMember(project.id, userId, role, token);
                await collaborationStore.sync(token);
                refreshWorkspace();
                setToast(t("common.toasts.roleUpdated"));
              } catch (error) {
                setToast(error instanceof Error ? error.message : t("common.errors.roleFailed"));
              }
            })();
          },
          onRemoveMember: (userId) => {
            void (async () => {
              const token = await getToken();
              if (!token) return;
              try {
                await api.removeProjectMember(project.id, userId, token);
                await collaborationStore.sync(token);
                refreshWorkspace();
                setToast(t("common.toasts.memberRemoved"));
              } catch (error) {
                setToast(error instanceof Error ? error.message : t("common.errors.removeFailed"));
              }
            })();
          },
          onCopyLink: () => {
            void (async () => {
              try {
                await navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}#project=${project.id}`);
                setToast(t("common.toasts.linkCopied"));
              } catch {
                setToast(t("common.errors.linkCopyFailed"));
              }
            })();
          },
        },
        overview: { lead: members.find((member) => member.role === "owner"), health: project.health ?? undefined, startDate: project.startDate ?? undefined, targetDate: project.targetDate ?? undefined },
      };
    }
    return result;
  }, [openNewTask, projects, tasks, user, refreshWorkspace, t]);

  const taskPlanning = useMemo<TaskPlanningProps | undefined>(() => {
    const projectId = composerProjectId !== undefined ? composerProjectId : editingTask?.projectId ?? newTaskContext?.projectId;
    const entry = projectId ? collaborationStore.get(projectId) : undefined;
    const availablePeople: Person[] = (entry?.members ?? []).map((member) => ({ id: member.userId, name: member.displayName || member.email, email: member.email, avatarUrl: member.avatarUrl }));
    if (user && !availablePeople.some((person) => person.id === user.id)) availablePeople.unshift({ id: user.id, name: user.displayName || user.email, email: user.email, avatarUrl: user.avatarUrl });
    const selectedIds = editingTask && editingTask.projectId === projectId ? editingTask.peopleIds ?? [] : user ? [user.id] : [];
    const people: TaskPerson[] = selectedIds.map((personId) => {
      const person = availablePeople.find((item) => item.id === personId) ?? { id: personId, name: t("common.planning.unknownPerson") };
      return { ...person, role: personId === user?.id ? "owner" : "collaborator" };
    });
    return {
      people,
      availablePeople,
      readOnly: entry?.role === "viewer" || Boolean(editingTask?.projectId && collaborationStore.role(editingTask.projectId) === "viewer"),
      fields: [
        { key: "state", label: t("common.planning.workflowState"), options: [{ id: "backlog", name: t("common.states.backlog") }, { id: "next", name: t("common.states.todo") }, { id: "in_progress", name: t("common.states.inProgress") }, { id: "done", name: t("common.states.done") }], selectedIds: [(() => { const raw = editingTask?.status ?? newTaskContext?.status ?? "backlog"; return raw === "inbox" ? "backlog" : raw; })()] },
      ],
    };
  }, [editingTask, newTaskContext, composerProjectId, user, projects, t]);

  async function logout() {
    const token = await getToken().catch(() => null);
    sessionGeneration.current += 1;
    realtimeGeneration.current += 1;
    const close = realtimeClose.current;
    realtimeClose.current = undefined;
    void close?.().catch((error) => console.warn("Prior realtime cleanup failed:", error));
    // Local logout must not wait for a network round trip. Remote revocation
    // is best-effort and the API client has a short timeout.
    await clearSession().catch((error) => console.warn("Prior could not clear the saved session:", error));
    await localStore.resetSyncRevision().catch((error) => console.warn("Prior could not reset sync state:", error));
    setUser(null);
    setAuthOpen(false);
    setSelectedProjectId(null);
    setNotesProjectId(null);
    setTasks([]);
    setHabits([]);
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
    void attachRealtime().catch((error) => console.warn("Prior realtime attach failed:", error));
    void syncNow();
    void pullAssistantSettings().catch((error) => console.warn("Prior assistant settings pull failed:", error));
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

  // One-tap update install from the banner: downloads, installs and
  // restarts the app (Windows stages the install and asks for a restart).
  async function installDesktopUpdate() {
    if (updateInstalling) return;
    setUpdateInstalling(true);
    try {
      await installAvailableUpdate();
      if (/Windows/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent)) {
        setToast(t("common.toasts.updateInstalled"));
      }
    } catch {
      setToast(t("common.errors.updateFailed"));
    } finally {
      setUpdateInstalling(false);
    }
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
      setAuthError(t("common.errors.googleFailed"));
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
        updateAvailable={desktopUpdate !== null}
        updateInstalling={updateInstalling}
        onInstallUpdate={() => void installDesktopUpdate()}
        inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen || projectEditor !== null || cycleEditor !== null}
        onViewChange={changeView}
        onAccount={() => setAuthOpen(true)}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onToggleAgent={() => setAgentOpen((value) => !value)}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <main className={`workspace ${activeView === "notes" ? "notes-workspace-page" : ""}`} inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen || projectEditor !== null || cycleEditor !== null}>
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
            key={user?.id ?? "anonymous"}
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
            onTaskEdit={(task) => { setComposerProjectId(task.projectId ?? null); setEditingTask(task); }}
            areas={areas}
            projects={projects}
            selectedProjectId={selectedProjectId}
            notesProjectId={notesProjectId}
            onOpenProject={openProject}
            onOpenNotes={openNotes}
            onOpenWaiting={openWaiting}
            onNewTask={openNewTask}
            onWorkspaceChange={refreshWorkspace}
            collaborationByProject={collaborationByProject}
          />
        </CompletionExitProvider>
        {visibleTasks.length === 0 && activeView === "all" && <button className="empty-add" type="button" onClick={() => openNewTask()}><Icon name="plus" /> {t("common.header.newTask")}</button>}
      </main>

      <AgentSidebar
        open={agentOpen}
        inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen || projectEditor !== null || cycleEditor !== null}
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

      {(composerOpen || editingTask) && <TaskComposer task={editingTask ?? undefined} areas={areas} projects={projects} initialContext={newTaskContext} planning={taskPlanning} onProjectChange={setComposerProjectId} onSave={editingTask ? saveEditedTask : saveTask} onCancel={() => { setComposerOpen(false); setEditingTask(null); setNewTaskContext(undefined); setComposerProjectId(undefined); }} />}
      {projectEditor && <ProjectEditor project={projectEditor} avatarUrl={user?.avatarUrl} onClose={() => setProjectEditor(null)} onSave={async (project) => { await saveProjectDetails(project); setProjectEditor(null); }} />}
      {cycleEditor && <ProjectCycleEditor
        cycle={projects.find((project) => project.id === cycleEditor.projectId)?.cycles?.find((cycle) => cycle.id === cycleEditor.cycleId)}
        issues={collaborationByProject[cycleEditor.projectId]?.issues ?? []}
        onClose={() => setCycleEditor(null)}
        onSave={async (draft) => {
          const project = projects.find((item) => item.id === cycleEditor.projectId);
          if (!project) throw new Error(t("common.errors.projectGone"));
          if (!draft.startsOn || !draft.endsOn) throw new Error(t("common.errors.chooseDates"));
          const cycle = { ...draft, startsOn: draft.startsOn, endsOn: draft.endsOn, id: cycleEditor.cycleId ?? crypto.randomUUID() };
          const cycles = cycleEditor.cycleId ? (project.cycles ?? []).map((item) => item.id === cycle.id ? cycle : item) : [...(project.cycles ?? []), cycle];
          await saveProjectDetails({ ...project, cycles });
          setCycleEditor(null);
        }}
      />}
      {habitComposerOpen && <HabitComposer habit={editingHabit ?? undefined} onSave={saveHabit} onCancel={() => { setHabitComposerOpen(false); setEditingHabit(null); }} />}
      {authOpen && <AccountDialog user={user} authError={authError} onClose={() => { setAuthOpen(false); setAuthError(""); }} onAuthenticated={handleAuthenticated} onGoogle={() => { void googleLogin(); }} onLogout={logout} onSettings={() => { setAuthOpen(false); setAuthError(""); changeView("settings"); }} />}
      {completionCelebration && <div className="completion-celebration" role="status" aria-live="polite"><span className="completion-celebration-icon"><Icon name="check" /><CompletionBurst trigger={completionCelebration.key} /></span><span><strong>{t("common.celebration.completed")}</strong><small>{completionCelebration.title}</small></span></div>}
      {toast && <div className="completion-celebration" role="status" aria-live="polite"><span><strong>{t("common.celebration.notice")}</strong><small>{toast}</small></span><button type="button" aria-label={t("common.actions.dismiss")} onClick={() => setToast(null)}>✕</button></div>}
    </div>
  );
}
