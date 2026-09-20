// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { pendingChats, queueAgentMessage, syncAgentOutbox } from "./agentOutbox";
import { api } from "./api";
import type { AgentMessage } from "../types";
vi.mock("./api", () => ({ api: { createAgentChat: vi.fn(), saveAgentChatMessage: vi.fn() } }));
beforeEach(() => { vi.stubGlobal("localStorage", memoryStorage()); vi.resetAllMocks(); });
const message: AgentMessage = { id: "message", role: "user", content: "Hello", createdAt: "2026-09-20T12:00:00Z" };
it("queues messages durably through failed sends and retries the same chat id", async () => {
  queueAgentMessage("chat", "Draft", message);
  vi.mocked(api.saveAgentChatMessage).mockRejectedValueOnce(new Error("offline"));
  await expect(syncAgentOutbox("token", () => true)).rejects.toThrow("offline");
  expect(pendingChats()[0].messages).toEqual([message]);
  await syncAgentOutbox("token", () => true);
  expect(api.createAgentChat).toHaveBeenLastCalledWith("Draft", "token", "chat");
  expect(pendingChats()).toEqual([]);
});
it("preserves newer proposal edits made while the old message uploads", async () => {
  queueAgentMessage("chat", "Draft", message);
  vi.mocked(api.saveAgentChatMessage).mockImplementationOnce(async () => {
    queueAgentMessage("chat", "Draft", { ...message, content: "Updated" });
    return message;
  });
  await syncAgentOutbox("token", () => true);
  expect(pendingChats()[0].messages[0].content).toBe("Updated");
});
it("never removes the new account's outbox after switching accounts", async () => {
  localStorage.setItem("prior.session.user", JSON.stringify({ id: "A" }));
  queueAgentMessage("chat", "Draft", message);
  vi.mocked(api.createAgentChat).mockImplementationOnce(async () => {
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "B" }));
    queueAgentMessage("other", "Private", message);
    return { id: "chat", title: "Draft", createdAt: "", updatedAt: "", messageCount: 0 };
  });
  await syncAgentOutbox("token", () => true);
  expect(api.saveAgentChatMessage).not.toHaveBeenCalled();
  expect(pendingChats()[0].id).toBe("other");
});
