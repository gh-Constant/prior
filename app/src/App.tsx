import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { clearSession, getToken, getUser, listenForAuth, startGoogleLogin, type SessionUser } from "./lib/auth";
import { localStore } from "./lib/localStore";
import { QUADRANTS, quadrantFor } from "./lib/priority";
import { connectRealtime } from "./lib/realtime";
import type { SyncState, Task } from "./types";
import { BrandMark } from "./components/BrandMark";
import { Icon } from "./components/Icon";
import { Quadrant } from "./components/Quadrant";
import { TaskComposer } from "./components/TaskComposer";
import { updateAndroidWidget } from "./lib/widget";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(() => getUser());
  const [syncState, setSyncState] = useState<SyncState>({ lastServerRevision: 0, pendingCount: 0 });
  const [syncMessage, setSyncMessage] = useState("Local only");
  const [accountOpen, setAccountOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [nextTasks, nextSync] = await Promise.all([localStore.listTasks(), localStore.getSyncState()]);
    setTasks(nextTasks);
    setSyncState(nextSync);
    void updateAndroidWidget(nextTasks).catch(() => undefined);
  }, []);

  const syncNow = useCallback(async () => {
    const token = await getToken();
    if (!token || !navigator.onLine) {
      setSyncMessage(navigator.onLine ? "Local only" : "Offline");
      return;
    }
    try {
      setSyncMessage("Syncing…");
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
      setSyncMessage("Up to date");
      await refresh();
    } catch {
      setSyncMessage("Couldn’t sync");
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
    void listenForAuth((nextUser) => { setUser(nextUser); void attachRealtime().catch(() => undefined); void syncNow(); }).then((cleanup) => { dispose = cleanup; });
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
        setAccountOpen(false);
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
    setAccountOpen(false);
    setSyncMessage("Local only");
  }

  const grouped = useMemo(() => Object.fromEntries(QUADRANTS.map((quadrant) => [quadrant.key, tasks.filter((task) => quadrantFor(task) === quadrant.key)])), [tasks]);
  const pendingLabel = user && syncState.pendingCount ? `${syncState.pendingCount} waiting` : syncMessage;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><BrandMark small /><span>Prior</span></div>
        <div className="topbar-actions">
          <span className={`sync-indicator ${syncMessage === "Up to date" ? "online" : ""}`}><span className="status-dot" />{pendingLabel}</span>
          <div className="account-wrap">
            <button className="avatar-button" aria-label={user ? "Open account menu" : "Sign in"} onClick={() => user ? setAccountOpen((open) => !open) : void startGoogleLogin()}>{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</button>
            {accountOpen && user && <div className="account-popover"><p className="account-name">{user.displayName || "Prior account"}</p><p className="account-email">{user.email}</p><button className="popover-action" onClick={() => void logout()}>Log out</button></div>}
          </div>
        </div>
      </header>

      <main className="content">
        <div className="intro-row"><div><p className="eyebrow">A little order</p><h1>What matters now.</h1></div><button className="add-button" onClick={() => setComposerOpen(true)}><Icon name="plus" /><span>New task</span><kbd>⌘ N</kbd></button></div>
        {composerOpen && <TaskComposer onSave={saveTask} onCancel={() => setComposerOpen(false)} />}
        {!user && <button className="sync-note" onClick={() => void startGoogleLogin()}><Icon name="cloud" />Sign in to keep tasks across devices <Icon name="arrow" /></button>}
        <div className="quadrant-grid">
          {QUADRANTS.map((quadrant) => <Quadrant key={quadrant.key} id={quadrant.key} label={quadrant.label} helper={quadrant.helper} tasks={grouped[quadrant.key] ?? []} onChange={changeTask} onDelete={deleteTask} />)}
        </div>
      </main>
      <footer className="footer"><span>{tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : "A clear place to start"}</span><span className="footer-key">⌘ N to add</span></footer>
    </div>
  );
}
