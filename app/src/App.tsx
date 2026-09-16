import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api";
import { clearSession, getToken, getUser, listenForAuth, startGoogleLogin, type SessionUser } from "./lib/auth";
import { localStore } from "./lib/localStore";
import { QUADRANTS, quadrantFor } from "./lib/priority";
import { connectRealtime } from "./lib/realtime";
import type { Habit, Task, TaskDraft } from "./types";
import { Icon } from "./components/Icon";
import { Quadrant } from "./components/Quadrant";
import { TaskComposer } from "./components/TaskComposer";
import { CompletionExitProvider, TaskRow } from "./components/TaskRow";
import { TaskColumns } from "./components/TaskColumns";
import { AuthModal } from "./components/AuthModal";
import { updateAndroidWidget } from "./lib/widget";
import { defaultTaskFilters, type TaskFilterState } from "./lib/taskFilters";
import { TaskFilters } from "./components/TaskFilters";
import { AgentSidebar } from "./components/AgentSidebar";
import { HabitComposer } from "./components/HabitComposer";
import { HabitView } from "./components/HabitView";
import { CompletionBurst } from "./components/CompletionBurst";
import { filterTasksWithExitingCompletions, useCompletionExits } from "./lib/completionExit";
import { AppSidebar, type WorkspaceView } from "./components/AppSidebar";
import { AgentIdentity } from "./components/AgentIdentity";

type Layout = "list" | "board";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [habitComposerOpen, setHabitComposerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState<SessionUser | null>(() => getUser());
  const [activeView, setActiveView] = useState<WorkspaceView>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("prior.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [taskFilters, setTaskFilters] = useState<TaskFilterState>(defaultTaskFilters);
  const [layout, setLayout] = useState<Layout>("list");
  const [completionCelebration, setCompletionCelebration] = useState<{ title: string; key: number } | null>(null);
  const celebrationKey = useRef(0);
  const syncInFlight = useRef<Promise<void> | null>(null);
  const syncQueued = useRef(false);
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
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ N" : "Ctrl N";
  const shortcutKey = shortcut.startsWith("⌘") ? "Meta+N" : "Control+N";
  const aiShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ J" : "Ctrl J";

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
        const pulled = await api.pull(state.lastServerRevision, token);
        if (generation !== sessionGeneration.current) return;
        await localStore.applyRemoteTasks(pulled.tasks);
        await localStore.applyRemoteHabits(pulled.habits ?? []);
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
    void syncNow();
    void attachRealtime().catch(() => undefined);
    const dispose = listenForAuth((nextUser) => {
      sessionGeneration.current += 1;
      setUser(nextUser);
      setAuthError("");
      setAuthOpen(false);
      void attachRealtime().catch(() => undefined);
      void syncNow();
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
  }, [attachRealtime, refresh, syncNow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (activeView === "habits") setHabitComposerOpen(true); else setComposerOpen(true);
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("online", syncNow);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("online", syncNow); };
  }, [activeView, syncNow]);

  async function saveTask(input: TaskDraft) {
    await localStore.saveTask(input);
    setComposerOpen(false);
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

  async function addAgentTasks(batch: TaskDraft[]) {
    for (const item of batch) {
      await localStore.saveTask(item);
    }
    await refresh();
    void syncNow();
  }

  async function addAgentHabits(batch: Array<Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">>) {
    for (const item of batch) {
      await localStore.saveHabit(item);
    }
    await refresh();
    void syncNow();
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

  async function saveHabit(input: Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">) {
    await localStore.saveHabit(input);
    setHabitComposerOpen(false);
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
    void attachRealtime().catch(() => undefined);
    void syncNow();
  }

  async function googleLogin() {
    setAuthError("");
    try {
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
        inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen}
        onViewChange={setActiveView}
        onAccount={() => setAuthOpen(true)}
        onToggle={() => setSidebarCollapsed((value) => !value)}
      />

      <main className="workspace" inert={composerOpen || editingTask !== null || habitComposerOpen || authOpen}>
        <header className="workspace-header">
          <h1>{activeView === "eisenhower" ? "Eisenhower" : activeView === "habits" ? "Habits" : "All tasks"}</h1>
          <div className="workspace-actions">
            {activeView === "all" && <div className="layout-switch" role="group" aria-label="Task layout">
              <button type="button" className={layout === "list" ? "active" : ""} aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><Icon name="list" /></button>
              <button type="button" className={layout === "board" ? "active" : ""} aria-label="Column view" title="Column view" aria-pressed={layout === "board"} onClick={() => setLayout("board")}><Icon name="columns" /></button>
            </div>}
            <button
              className={`ai-toggle-button ${agentOpen ? "active" : ""}`}
              type="button"
              aria-label="AI Assistant"
              title={`AI Assistant (${aiShortcut})`}
              aria-pressed={agentOpen}
              onClick={() => setAgentOpen((v) => !v)}
            >
              <AgentIdentity size="tiny" />
              <span>AI Assistant</span>
              <kbd>{aiShortcut}</kbd>
            </button>
            <button className="primary-button new-task-button" type="button" aria-label={activeView === "habits" ? "New habit" : "New task"} title={`${activeView === "habits" ? "New habit" : "New task"} (${shortcut})`} aria-keyshortcuts={shortcutKey} onClick={() => activeView === "habits" ? setHabitComposerOpen(true) : setComposerOpen(true)}><Icon name="plus" /><span>{activeView === "habits" ? "New habit" : "New task"}</span><kbd>{shortcut}</kbd></button>
          </div>
        </header>

        {activeView !== "habits" && <TaskFilters value={taskFilters} onChange={setTaskFilters} />}

        <CompletionExitProvider deadlines={completionExitDeadlines}>
          {activeView === "habits" ? <HabitView habits={habits} onAdd={() => setHabitComposerOpen(true)} onComplete={completeHabit} onChange={changeHabit} onDelete={deleteHabit} /> : activeView === "eisenhower" ? (
            <div className="quadrant-grid">
              {QUADRANTS.map((quadrant) => <Quadrant key={quadrant.key} id={quadrant.key} label={quadrant.label} tasks={grouped[quadrant.key] ?? []} onChange={changeTask} onDelete={deleteTask} onEdit={(task) => setEditingTask(task)} />)}
            </div>
          ) : layout === "board" ? (
            <TaskColumns tasks={visibleTasks} onChange={changeTask} onDelete={deleteTask} onEdit={(task) => setEditingTask(task)} />
          ) : (
            <section className="list-view" aria-label="All tasks">
              {visibleTasks.map((task) => <TaskRow key={task.id} task={task} onChange={changeTask} onDelete={deleteTask} onEdit={(nextTask) => setEditingTask(nextTask)} />)}
            </section>
          )}
        </CompletionExitProvider>
        {visibleTasks.length === 0 && activeView === "all" && <button className="empty-add" type="button" onClick={() => setComposerOpen(true)}><Icon name="plus" /> New task</button>}
      </main>

      <AgentSidebar
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        tasks={tasks}
        habits={habits}
        user={user}
        onAddTasks={addAgentTasks}
        onAddHabits={addAgentHabits}
      />

      {(composerOpen || editingTask) && <TaskComposer task={editingTask ?? undefined} onSave={editingTask ? saveEditedTask : saveTask} onCancel={() => { setComposerOpen(false); setEditingTask(null); }} />}
      {habitComposerOpen && <HabitComposer onSave={saveHabit} onCancel={() => setHabitComposerOpen(false)} />}
      {authOpen && <AuthModal user={user} authError={authError} onClose={() => { setAuthOpen(false); setAuthError(""); }} onAuthenticated={handleAuthenticated} onGoogle={() => { void googleLogin(); }} onLogout={logout} />}
      {completionCelebration && <div className="completion-celebration" role="status" aria-live="polite"><span className="completion-celebration-icon"><Icon name="check" /><CompletionBurst trigger={completionCelebration.key} /></span><span><strong>Completed</strong><small>{completionCelebration.title}</small></span></div>}
    </div>
  );
}
