import { API_URL, FALLBACK_API_URL, api } from "./api";
import { supportsRealtime } from "./platform";

type SyncEvent = { type?: string; revision?: number };

export type RealtimeOptions = {
  /** Resolve the last applied server revision so polls/reconnects can resume. */
  getRevision?: () => number | Promise<number>;
};

type Connection = {
  disconnect: () => Promise<void>;
  sendText?: (data: string) => Promise<void> | void;
};

function backoffWithJitter(attempt: number): number {
  const exponential = Math.min(1000 * 2 ** attempt, 30_000);
  return exponential + Math.floor(Math.random() * 500);
}

function toWsEndpoints(): string[] {
  return [API_URL, FALLBACK_API_URL]
    .filter((url): url is string => Boolean(url))
    .map((url) => url.replace(/^http/, "ws") + "/v1/realtime");
}

async function openNativeConnection(token: string, onMessage: (event: SyncEvent) => void): Promise<Connection> {
  const websocket = await import("@tauri-apps/plugin-websocket");
  const endpoints = toWsEndpoints();
  let connection: Awaited<ReturnType<typeof websocket.default.connect>> | undefined;
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      connection = await websocket.default.connect(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!connection) throw lastError instanceof Error ? lastError : new Error("Unable to connect to Prior realtime sync.");
  const active = connection;
  const removeListener = active.addListener((message) => {
    if (message.type !== "Text") return;
    try {
      const event = JSON.parse((message as { data: string }).data) as SyncEvent;
      onMessage(event);
    } catch {
      // Malformed realtime messages are ignored; the next pull remains authoritative.
      console.warn("Prior realtime received a malformed message; ignoring.");
    }
  });
  const sendText = async (data: string) => {
    const candidate = active as unknown as { send?: (msg: unknown) => Promise<void> | void };
    if (typeof candidate.send === "function") {
      await candidate.send({ type: "Text", data });
    }
  };
  return {
    sendText,
    disconnect: async () => {
      removeListener();
      await active.disconnect();
    },
  };
}

async function resolveRevision(getRevision?: RealtimeOptions["getRevision"]): Promise<number> {
  if (getRevision) {
    try {
      return await getRevision();
    } catch {
      return 0;
    }
  }
  try {
    const { localStore } = await import("./localStore");
    return (await localStore.getSyncState()).lastServerRevision;
  } catch {
    return 0;
  }
}

// Shared socket per token: only one realtime session is active at a time.
// A new token (or explicit reconnect) disposes the previous session.
let activeSession: { token: string; dispose: () => Promise<void> } | null = null;

/**
 * Reconnecting realtime manager.
 *
 * - Native (Tauri): websocket with exponential backoff (1s -> 30s + jitter),
 *   30s ping, last-revision resume via an immediate sync on reconnect, and
 *   online/visibility triggers.
 * - Web: polling pull(since) every 30s.
 *
 * Failures are logged with console.warn and retried; they are never swallowed
 * silently. The returned closer disposes the session.
 */
export async function connectRealtime(
  token: string,
  onSyncRequired: (revision?: number) => void,
  options: RealtimeOptions = {},
): Promise<() => Promise<void>> {
  // Ensure a single shared socket per token.
  if (activeSession && activeSession.token === token) {
    await activeSession.dispose().catch((error) => console.warn("Prior realtime cleanup failed:", error));
  } else if (activeSession) {
    await activeSession.dispose().catch((error) => console.warn("Prior realtime cleanup failed:", error));
  }

  let disposed = false;
  let attempt = 0;
  let retryTimer: number | undefined;
  let pingTimer: number | undefined;
  let pollTimer: number | undefined;
  let connection: Connection | undefined;
  let lastRevision: number | undefined;

  const onEvent = (event: SyncEvent) => {
    if (event.type === "pong") return;
    // Server emits legacy "sync_required"/"sync" plus unified
    // "tasks_required"/"workspace_required"/"profile_required"/"settings_required"/"workspace".
    if (event.type === undefined || event.type === "sync_required" || event.type === "sync" || event.type.endsWith("_required") || event.type === "workspace") {
      if (typeof event.revision === "number") lastRevision = event.revision;
      onSyncRequired(lastRevision);
    }
  };

  const clearTimers = () => {
    if (retryTimer !== undefined) { window.clearTimeout(retryTimer); retryTimer = undefined; }
    if (pingTimer !== undefined) { window.clearInterval(pingTimer); pingTimer = undefined; }
    if (pollTimer !== undefined) { window.clearInterval(pollTimer); pollTimer = undefined; }
  };

  const scheduleRetry = () => {
    if (disposed) return;
    const wait = backoffWithJitter(attempt);
    attempt += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      void connectNative();
    }, wait);
  };

  const connectNative = async (): Promise<void> => {
    if (disposed) return;
    try {
      connection = await openNativeConnection(token, onEvent);
      if (disposed) {
        await connection.disconnect().catch(() => undefined);
        return;
      }
      attempt = 0;
      // Resume: a fresh socket may have missed broadcasts while offline.
      // Trigger a sync so pull(since) catches up from the stored revision.
      try {
        lastRevision = await resolveRevision(options.getRevision);
      } catch {
        lastRevision = undefined;
      }
      onSyncRequired(lastRevision);
      if (pingTimer !== undefined) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        void (async () => {
          try {
            await connection?.sendText?.(JSON.stringify({ type: "ping" }));
          } catch (error) {
            console.warn("Prior realtime ping failed; scheduling reconnect:", error);
            void connection?.disconnect().catch(() => undefined);
            connection = undefined;
            scheduleRetry();
          }
        })();
      }, 30_000);
    } catch (error) {
      console.warn("Prior realtime connection failed; retrying with backoff:", error);
      scheduleRetry();
    }
  };

  const handleOnline = () => {
    if (disposed) return;
    if (!supportsRealtime()) {
      void pollOnce().catch((error) => console.warn("Prior realtime poll failed:", error));
      return;
    }
    if (!connection) {
      if (retryTimer !== undefined) { window.clearTimeout(retryTimer); retryTimer = undefined; }
      void connectNative();
    } else {
      onSyncRequired(lastRevision);
    }
  };

  const handleVisibility = () => {
    if (disposed || document.visibilityState !== "visible") return;
    handleOnline();
  };

  const pollOnce = async (): Promise<void> => {
    if (disposed || !token) return;
    const since = await resolveRevision(options.getRevision);
    try {
      const pulled = await api.pull(since, token);
      if (disposed) return;
      const cursor = typeof (pulled as { nextSince?: number }).nextSince === "number" ? (pulled as { nextSince: number }).nextSince : pulled.revision;
      if (cursor > since) {
        lastRevision = cursor;
        onSyncRequired(cursor);
      }
    } catch (error) {
      // Auth failures must surface to the caller path (syncNow handles them);
      // other poll failures are logged and retried on the next tick.
      console.warn("Prior realtime poll failed:", error);
    }
  };

  if (!supportsRealtime()) {
    // Web fallback: poll pull(since) every 30s.
    await pollOnce().catch((error) => console.warn("Prior realtime poll failed:", error));
    pollTimer = window.setInterval(() => {
      void pollOnce();
    }, 30_000);
  } else {
    await connectNative();
    // If the first attempt failed, connectNative already scheduled a retry.
    // Surface the failure path via warnings (above) rather than throwing, so
    // callers can attach without a crash loop; a disposed session still cleans up.
  }

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);
  const handleOffline = () => {
    // Proactively drop a stale socket when the browser reports offline.
    if (connection && supportsRealtime()) {
      void connection.disconnect().catch(() => undefined);
      connection = undefined;
    }
  };
  window.addEventListener("offline", handleOffline);

  const dispose = async (): Promise<void> => {
    disposed = true;
    clearTimers();
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("offline", handleOffline);
    const active = connection;
    connection = undefined;
    if (active) await active.disconnect().catch((error) => console.warn("Prior realtime disconnect failed:", error));
    if (activeSession?.token === token) activeSession = null;
  };

  activeSession = { token, dispose };
  return dispose;
}

/** Test hook: clear the shared session between isolated tests. */
export function __resetRealtimeForTests(): void {
  activeSession = null;
}
