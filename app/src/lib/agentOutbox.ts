import type { AgentMessage } from "../types";
import { getAccountId, readScopedStorage, writeScopedStorage } from "./accountScope";
import { api } from "./api";
import { ACCOUNT_DATA_LOCAL } from "./accountDocuments";

const KEY = "prior.agent-outbox.v1";
type PendingChat = { id: string; title: string; messages: AgentMessage[] };
export function pendingChats(): PendingChat[] { return JSON.parse(readScopedStorage(KEY) ?? "[]") as PendingChat[]; }
export function queueAgentMessage(id: string, title: string, message?: AgentMessage): void {
  const pending = pendingChats();
  const chat = pending.find((item) => item.id === id) ?? { id, title, messages: [] };
  if (message) chat.messages = [...chat.messages.filter((item) => item.id !== message.id), message];
  writeScopedStorage(KEY, JSON.stringify([...pending.filter((item) => item.id !== id), chat]));
  window.dispatchEvent(new Event(ACCOUNT_DATA_LOCAL));
}
let inFlight: Promise<void> | null = null;
export async function syncAgentOutbox(token: string, isCurrent: () => boolean): Promise<void> {
  if (inFlight) { await inFlight; return; }
  const account = getAccountId();
  const current = () => isCurrent() && account === getAccountId();
  const run = (async () => {
    for (const chat of pendingChats()) {
      if (!current()) return;
      await api.createAgentChat(chat.title, token, chat.id);
      if (!current()) return;
      for (const message of chat.messages) {
        await api.saveAgentChatMessage(chat.id, message, token);
        if (!current()) return;
        const pending = pendingChats();
        const latest = pending.find((item) => item.id === chat.id);
        if (latest) latest.messages = latest.messages.filter((item) => item.id !== message.id || JSON.stringify(item) !== JSON.stringify(message));
        writeScopedStorage(KEY, JSON.stringify(pending));
      }
      writeScopedStorage(KEY, JSON.stringify(pendingChats().filter((item) => item.id !== chat.id || item.messages.length > 0)));
    }
  })();
  inFlight = run;
  try { await run; } finally { if (inFlight === run) inFlight = null; }
}
