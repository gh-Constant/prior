import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { clearSession, getToken, getUser, listenForAuth, startGoogleLogin, type SessionUser } from "./lib/auth";
import { localStore } from "./lib/localStore";
import { QUADRANTS, quadrantFor } from "./lib/priority";
import { connectRealtime } from "./lib/realtime";
import type { Task } from "./types";
import { BrandMark } from "./components/BrandMark";
import { Icon } from "./components/Icon";
import { Quadrant } from "./components/Quadrant";
import { TaskComposer } from "./components/TaskComposer";
import { TaskRow } from "./components/TaskRow";
import { TaskColumns } from "./components/TaskColumns";
import { AuthModal } from "./components/AuthModal";
import { updateAndroidWidget } from "./lib/widget";
import { defaultTaskFilters, filterTasks, type TaskFilterState } from "./lib/taskFilters";

type WorkspaceView = "eisenhower" | "all";
type Layout = "list" | "board";
import { TaskFilters } from "./components/TaskFilters";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(() => getUser());
  const [activeView, setActiveView] = useState<WorkspaceView>("eisenhower");
  const [taskFilters, setTaskFilters] = useState<TaskFilterState>(defaultTaskFilters);
  const [layout, setLayout] = useState<Layout>("list");
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ N" : "Ctrl N";
  const shortcutKey = shortcut.startsWith("⌘") ? "Meta+N" : "Control+N";

  const refresh = useCallback(async () => {
    const nextTasks = await localStore.listTasks();
    setTasks(nextTasks);
    void updateAndroidWidget(nextTasks).catch(() => undefined);
  }, []);

  const syncNow = useCallback(async () => {
    const token = await getToken();
    if (!token || !navigator.onLine) return;
    try {
      const pending = await localStore.pendingMutations();
      if (pending.length) {
        const pushed = await api.push(pending, token);
        await localStore.removeMutations(pushed.applied.map((item) => item.mutationId));
        const current = await localStore.getSyncState();
        const highest = pushed.applied.reduce((value, item) => Math.max(value, item.revision), current.lastServerRevision);
        await localStore.setSyncRevision(highest);
      }
      const state = await localStore.getSyncState();
      const pulled = await api.pull(state.lastServerRevision, token);
      await localStore.applyRemoteTasks(pulled.tasks);
      await localStore.setSyncRevision(pulled.revision);
      await refresh();
    } catch {
      // Local data remains authoritative until the next successful sync.
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    let closeRealtime: (() => Promise<void>) | undefined;
    const attachRealtime = async () => {
      const token = await getToken();
      if (!token) return;
      await closeRealtime?.();
      closeRealtime = await connectRealtime(token, () => void syncNow());
    };
    void attachRealtime().catch(() => undefined);
    let dispose: (() => void) | undefined;
    void listenForAuth((nextUser) => {
      setUser(nextUser);
      setAuthOpen(false);
      void attachRealtime().catch(() => undefined);
      void syncNow();
    }).then((cleanup) => { dispose = cleanup; });
    return () => { dispose?.(); void closeRealtime?.(); };
  }, [refresh, syncNow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setComposerOpen(true);
      }
      if (event.key === "Escape") {
        setComposerOpen(false);
        setAuthOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("online", syncNow);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("online", syncNow); };
  }, [syncNow]);

  async function saveTask(input: Pick<Task, "title" | "important" | "urgent">) {
    await localStore.saveTask(input);
    setComposerOpen(false);
    await refresh();
    void syncNow();
  }

  async function changeTask(task: Task) {
    await localStore.updateTask(task);
    await refresh();
    void syncNow();
  }

  async function deleteTask(task: Task) {
    await localStore.removeTask(task);
    await refresh();
    void syncNow();
  }

  async function logout() {
    const token = await getToken();
    if (token) await api.logout(token).catch(() => undefined);
    await clearSession();
    setUser(null);
    setAuthOpen(false);
  }

  const visibleTasks = useMemo(() => filterTasks(tasks, taskFilters), [tasks, taskFilters]);

  const grouped = useMemo(() => Object.fromEntries(QUADRANTS.map((quadrant) => [quadrant.key, visibleTasks.filter((task) => quadrantFor(task) === quadrant.key)])), [visibleTasks]);

  function handleAuthenticated(nextUser: SessionUser) {
    setUser(nextUser);
    setAuthOpen(false);
    void syncNow();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand" title="Prior"><BrandMark withTitle /></div>
        <button className="sidebar-new" type="button" aria-keyshortcuts={shortcutKey} onClick={() => setComposerOpen(true)}><Icon name="plus" /><span>New task</span><kbd>{shortcut}</kbd></button>
        <nav className="sidebar-nav" aria-label="Task views">
          <button type="button" className={`nav-item ${activeView === "eisenhower" ? "active" : ""}`} aria-current={activeView === "eisenhower" ? "page" : undefined} onClick={() => setActiveView("eisenhower")}>
            <Icon name="grid" /><span>Eisenhower</span>
          </button>
          <button type="button" className={`nav-item ${activeView === "all" ? "active" : ""}`} aria-current={activeView === "all" ? "page" : undefined} onClick={() => setActiveView("all")}>
            <Icon name="inbox" /><span>All tasks</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="account-trigger" type="button" onClick={() => setAuthOpen(true)}>
            <span className="account-trigger-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</span>
            <span className="account-trigger-label">{user?.displayName || "Account"}</span>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <h1>{activeView === "eisenhower" ? "Eisenhower" : "All tasks"}</h1>
          <div className="workspace-actions">
            {activeView === "all" && <div className="layout-switch" role="group" aria-label="Task layout">
              <button type="button" className={layout === "list" ? "active" : ""} aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><Icon name="list" /></button>
              <button type="button" className={layout === "board" ? "active" : ""} aria-label="Column view" aria-pressed={layout === "board"} onClick={() => setLayout("board")}><Icon name="grid" /></button>
            </div>}
            <button className="primary-button new-task-button" type="button" aria-keyshortcuts={shortcutKey} onClick={() => setComposerOpen(true)}><Icon name="plus" /><span>New task</span><kbd>{shortcut}</kbd></button>
          </div>
        </header>

        <TaskFilters value={taskFilters} onChange={setTaskFilters} />

        {activeView === "eisenhower" ? (
          <div className="quadrant-grid">
            {QUADRANTS.map((quadrant) => <Quadrant key={quadrant.key} id={quadrant.key} label={quadrant.label} tasks={grouped[quadrant.key] ?? []} onChange={changeTask} onDelete={deleteTask} />)}
          </div>
        ) : layout === "board" ? (
          <TaskColumns tasks={visibleTasks} onChange={changeTask} onDelete={deleteTask} />
        ) : (
          <section className="list-view" aria-label="All tasks">
            {visibleTasks.map((task) => <TaskRow key={task.id} task={task} onChange={changeTask} onDelete={deleteTask} />)}
          </section>
        )}
      </main>

      {composerOpen && <TaskComposer onSave={saveTask} onCancel={() => setComposerOpen(false)} />}
      {authOpen && <AuthModal user={user} onClose={() => setAuthOpen(false)} onAuthenticated={handleAuthenticated} onGoogle={() => { setAuthOpen(false); void startGoogleLogin(); }} onLogout={logout} />}
    </div>
  );
}
