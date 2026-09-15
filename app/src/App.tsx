import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { clearSession, getToken, getUser, listenForAuth, startGoogleLogin, type SessionUser } from "./lib/auth";
import { localStore } from "./lib/localStore";
import { QUADRANTS, quadrantFor } from "./lib/priority";
import { connectRealtime } from "./lib/realtime";
import type { QuadrantKey, Task } from "./types";
import { BrandMark } from "./components/BrandMark";
import { Icon, type IconName } from "./components/Icon";
import { Quadrant } from "./components/Quadrant";
import { TaskComposer } from "./components/TaskComposer";
import { TaskRow } from "./components/TaskRow";
import { AuthModal } from "./components/AuthModal";
import { updateAndroidWidget } from "./lib/widget";

type ViewKey = "all" | QuadrantKey | "important" | "urgent" | "completed";
type Layout = "list" | "board";

const navigation: Array<{ key: ViewKey; label: string; icon: IconName }> = [
  { key: "all", label: "All tasks", icon: "inbox" },
  { key: "focus", label: "Focus", icon: "focus" },
  { key: "plan", label: "Plan", icon: "plan" },
  { key: "quick", label: "Quick", icon: "quick" },
  { key: "later", label: "Later", icon: "later" },
  { key: "important", label: "Important", icon: "important" },
  { key: "urgent", label: "Urgent", icon: "bolt" },
  { key: "completed", label: "Completed", icon: "check-circle" },
];

const titles: Record<ViewKey, string> = {
  all: "All tasks",
  focus: "Focus",
  plan: "Plan",
  quick: "Quick",
  later: "Later",
  important: "Important",
  urgent: "Urgent",
  completed: "Completed",
};

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(() => getUser());
  const [view, setView] = useState<ViewKey>("all");
  const [layout, setLayout] = useState<Layout>("list");

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

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (view === "completed") return task.completed;
    if (task.completed) return false;
    if (view === "all") return true;
    if (view === "important") return task.important;
    if (view === "urgent") return task.urgent;
    return quadrantFor(task) === view;
  }), [tasks, view]);

  const grouped = useMemo(() => Object.fromEntries(QUADRANTS.map((quadrant) => [quadrant.key, visibleTasks.filter((task) => quadrantFor(task) === quadrant.key)])), [visibleTasks]);

  function handleAuthenticated(nextUser: SessionUser) {
    setUser(nextUser);
    setAuthOpen(false);
    void syncNow();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand" title="Prior"><BrandMark /></div>
        <button className="sidebar-new" type="button" onClick={() => setComposerOpen(true)}><Icon name="plus" /><span>New task</span></button>
        <nav className="sidebar-nav" aria-label="Task views">
          {navigation.map((item) => (
            <button key={item.key} type="button" className={`nav-item ${view === item.key ? "active" : ""}`} aria-current={view === item.key ? "page" : undefined} onClick={() => setView(item.key)}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </button>
          ))}
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
          <h1>{titles[view]}</h1>
          <div className="workspace-actions">
            <div className="layout-switch" role="group" aria-label="Task layout">
              <button type="button" className={layout === "list" ? "active" : ""} aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><Icon name="list" /></button>
              <button type="button" className={layout === "board" ? "active" : ""} aria-label="Board view" aria-pressed={layout === "board"} onClick={() => setLayout("board")}><Icon name="grid" /></button>
            </div>
            <button className="primary-button new-task-button" type="button" onClick={() => setComposerOpen(true)}><Icon name="plus" /><span>New task</span></button>
          </div>
        </header>

        {layout === "board" ? (
          <div className="quadrant-grid">
            {QUADRANTS.map((quadrant) => <Quadrant key={quadrant.key} id={quadrant.key} label={quadrant.label} tasks={grouped[quadrant.key] ?? []} onChange={changeTask} onDelete={deleteTask} />)}
          </div>
        ) : (
          <section className="list-view" aria-label={titles[view]}>
            {visibleTasks.map((task) => <TaskRow key={task.id} task={task} onChange={changeTask} onDelete={deleteTask} />)}
          </section>
        )}
      </main>

      {composerOpen && <TaskComposer onSave={saveTask} onCancel={() => setComposerOpen(false)} />}
      {authOpen && <AuthModal user={user} onClose={() => setAuthOpen(false)} onAuthenticated={handleAuthenticated} onGoogle={() => { setAuthOpen(false); void startGoogleLogin(); }} onLogout={logout} />}
    </div>
  );
}
