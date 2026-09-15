import { API_URL } from "./api";

type SyncEvent = { type?: string; revision?: number };

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function connectRealtime(token: string, onSyncRequired: () => void): Promise<() => Promise<void>> {
  if (!isTauri()) return async () => undefined;
  const websocket = await import("@tauri-apps/plugin-websocket");
  const endpoint = API_URL.replace(/^http/, "ws") + "/v1/realtime";
  const connection = await websocket.default.connect(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const removeListener = connection.addListener((message) => {
    if (message.type !== "Text") return;
    try {
      const event = JSON.parse(message.data) as SyncEvent;
      if (event.type === "sync_required") onSyncRequired();
    } catch { /* malformed realtime messages are ignored; the next pull remains authoritative */ }
  });
  return async () => { removeListener(); await connection.disconnect(); };
}
