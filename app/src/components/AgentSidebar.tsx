import { useEffect, useRef, useState } from "react";
import type { AgentChatSummary, AgentMessage, AgentSettings, Habit, NoteDraft, NoteFolderDraft, ProposedFolder, ProposedHabit, ProposedNote, ProposedTask, Task, TaskDraft } from "../types";
import { askAgent, DEFAULT_MODEL, fetchAvailableFreeModels, getAgentSettings, POPULAR_FREE_MODELS, saveAgentSettings } from "../lib/ai";
import { getToken, type SessionUser } from "../lib/auth";
import { api } from "../lib/api";
import "./AgentSidebar.css";
import { AgentIdentity } from "./AgentIdentity";
import { AssistantMessage, folderDraftOf, habitDraftOf, markFoldersAdded, markHabitsAdded, markNotesAdded, markTasksAdded, noteDraftOf, taskDraftOf, updateFolderProposal, updateHabitProposal, updateNoteProposal, updateTaskProposal, type AssistantMessageHandlers } from "./AgentMessageView";
import { notesStore } from "../lib/notes";
import { Icon } from "./Icon";
import { DictationControls, DictationPreview, DictationStatusBar } from "./DictationControls";
import { useDictation } from "../hooks/useDictation";

type Props = {
  readonly open: boolean;
  readonly inert?: boolean;
  readonly onClose: () => void;
  readonly tasks: Task[];
  readonly habits: Habit[];
  readonly user: SessionUser | null;
  readonly onAddTasks: (tasks: TaskDraft[]) => Promise<void>;
  readonly onAddHabits: (habits: Array<Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">>) => Promise<void>;
  readonly onAddNotes: (notes: NoteDraft[]) => Promise<void>;
  readonly onAddFolders: (folders: NoteFolderDraft[]) => Promise<void>;
};

const STARTER_PROMPTS = [
  { icon: "bolt" as const, title: "Plan today's priorities", prompt: "Help me prioritize today. I need to focus on high-impact work and handle urgent deadlines first." },
  { icon: "inbox" as const, title: "Triage a brain dump", prompt: "Here is a brain dump of things on my mind: " },
  { icon: "plan" as const, title: "Break down a project", prompt: "Break down this project into atomic, actionable Eisenhower tasks with clear urgency and importance: " },
  { icon: "file-text" as const, title: "Turn into a note", prompt: "Turn the following into a well-structured Markdown note with headings, a task list, and a table where useful: " },
  { icon: "sparkles" as const, title: "Organize my inbox", prompt: "Review my current task list and suggest what to tackle first, what to schedule, and what to defer." },
];

function useOverlayMode(): boolean {
  const [isOverlay, setIsOverlay] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(max-width: 1100px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)");
    const onChange = (event: MediaQueryListEvent) => setIsOverlay(event.matches);
    setIsOverlay(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isOverlay;
}

function shortModelName(id: string): string {
  if (id === DEFAULT_MODEL) return "Free model";
  return id.split("/").pop()?.replace(":free", "") || id;
}

function modelConfirmLabel(customDraft: string, listDraft: string): string {
  const effective = customDraft.trim() || listDraft.trim() || DEFAULT_MODEL;
  if (effective === DEFAULT_MODEL) return "Use free model";
  return `Use ${shortModelName(effective)}`;
}

export function AgentSidebar({ open, inert, onClose, tasks, habits, user, onAddTasks, onAddHabits, onAddNotes, onAddFolders }: Props) {
  const [settings, setSettings] = useState<AgentSettings>(() => getAgentSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey);
  const [modelInput, setModelInput] = useState(settings.model);
  const [webSearchInput, setWebSearchInput] = useState(settings.webSearch !== false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [modelList, setModelList] = useState(POPULAR_FREE_MODELS);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [listDraft, setListDraft] = useState(settings.model);
  const [customDraft, setCustomDraft] = useState("");

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [chatHistory, setChatHistory] = useState<AgentChatSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Record<string, boolean>>({});
  const [dictationLanguage] = useState(() => typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const isComposingRef = useRef(false);
  const isOverlay = useOverlayMode();
  const pendingDictationSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const dictationSelectionRef = useRef<{ start: number; end: number } | null>(null);

  const dictation = useDictation({
    enabled: open,
    language: dictationLanguage,
    onCommit: ({ value, selectionStart, selectionEnd }) => {
      dictationSelectionRef.current = null;
      pendingDictationSelectionRef.current = { start: selectionStart, end: selectionEnd };
      setInput(value);
      window.setTimeout(() => {
        if (!textareaRef.current || pendingDictationSelectionRef.current?.start !== selectionStart) return;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
        pendingDictationSelectionRef.current = null;
      }, 0);
    },
  });

  useEffect(() => {
    void fetchAvailableFreeModels().then((list) => {
      if (list?.length) setModelList(list);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!open || !user) {
      if (!user) {
        setSessionToken(null);
        setChatHistory([]);
        setActiveChatId(null);
        setMessages([]);
      }
      return () => { cancelled = true; };
    }

    setHistoryLoading(true);
    void getToken()
      .then(async (token) => {
        if (cancelled) return;
        setSessionToken(token);
        if (!token) {
          setChatHistory([]);
          return;
        }
        const chats = await api.listAgentChats(token);
        if (!cancelled) setChatHistory(chats);
      })
      .catch(() => {
        if (!cancelled) setChatHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, user]);

  useEffect(() => {
    if (open && isOverlay) {
      window.setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [open, isOverlay]);

  useEffect(() => {
    if (!open || !isOverlay) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, [open, isOverlay]);

  useEffect(() => {
    if (!open || !isOverlay) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isOverlay]);

  useEffect(() => {
    if (!open || !isOverlay) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (modelModalOpen) {
          setModelModalOpen(false);
          return;
        }
        if (dictation.isActive) {
          cancelDictation();
          return;
        }
        if (settingsOpen) setSettingsOpen(false); else onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea, input:not(:disabled), select:not(:disabled), a[href]'
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [dictation, open, onClose, settingsOpen, isOverlay, modelModalOpen]);

  useEffect(() => {
    // Docked mode has no focus trap; still let Escape dismiss the model modal
    // before the app-level handler can close the whole sidebar.
    if (!open || isOverlay || !modelModalOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setModelModalOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, isOverlay, modelModalOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleSaveSettings() {
    const updated: AgentSettings = {
      apiKey: apiKeyInput.trim(),
      model: modelInput.trim() || DEFAULT_MODEL,
      webSearch: webSearchInput,
    };
    setSettings(updated);
    saveAgentSettings(updated);
    setSettingsOpen(false);
    setError(null);
  }

  function handleClose(): void {
    dictation.stop();
    setModelModalOpen(false);
    onClose();
  }

  function openSettings(): void {
    dictation.stop();
    setSettingsOpen((value) => !value);
  }

  function openModelModal(): void {
    dictation.stop();
    const current = modelInput.trim() || DEFAULT_MODEL;
    if (modelList.some((m) => m.id === current)) {
      setListDraft(current);
      setCustomDraft("");
    } else {
      setListDraft(modelList[0]?.id ?? DEFAULT_MODEL);
      setCustomDraft(current);
    }
    setModelSearch("");
    setModelModalOpen(true);
  }

  function confirmModelModal(): void {
    const effective = customDraft.trim() || listDraft.trim() || DEFAULT_MODEL;
    setModelInput(effective);
    setModelModalOpen(false);
  }

  useEffect(() => {
    if (modelModalOpen) window.setTimeout(() => modelSearchRef.current?.focus(), 60);
  }, [modelModalOpen]);

  function startDictation(): void {
    const textarea = textareaRef.current;
    if (!textarea || dictation.isActive) return;
    const selection = {
      start: textarea.selectionStart ?? input.length,
      end: textarea.selectionEnd ?? input.length,
    };
    dictationSelectionRef.current = selection;
    void dictation.start(input, selection);
  }

  function cancelDictation(): void {
    const selection = dictationSelectionRef.current;
    dictation.cancel();
    dictationSelectionRef.current = null;
    if (selection && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(selection.start, selection.end);
    }
  }

  async function ensureChat(token: string): Promise<string | null> {
    if (activeChatId) return activeChatId;
    try {
      const chat = await api.createAgentChat("New chat", token);
      setActiveChatId(chat.id);
      setChatHistory((current) => [chat, ...current.filter((item) => item.id !== chat.id)]);
      return chat.id;
    } catch {
      return null;
    }
  }

  async function persistMessage(chatId: string, message: AgentMessage, token: string): Promise<void> {
    try {
      await api.saveAgentChatMessage(chatId, message, token);
      const chats = await api.listAgentChats(token);
      setChatHistory(chats);
    } catch {
      // Keep the conversation usable when the sync API is temporarily unavailable.
    }
  }

  async function selectChat(chatId: string) {
    if (!sessionToken || chatId === activeChatId || chatLoading || loading || dictation.isActive) return;
    setChatLoading(true);
    setError(null);
    try {
      const chat = await api.getAgentChat(chatId, sessionToken);
      setActiveChatId(chat.id);
      setMessages(chat.messages ?? []);
      setInput("");
      if (window.matchMedia("(max-width: 760px)").matches) setHistoryOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load this conversation.");
    } finally {
      setChatLoading(false);
    }
  }

  function startNewChat() {
    if (loading || chatLoading || dictation.isActive) return;
    setActiveChatId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setSettingsOpen(false);
    setModelModalOpen(false);
  }

  async function handleSend(customPrompt?: string) {
    const promptToSend = (customPrompt ?? input).trim();
    if (!promptToSend || loadingRef.current || dictation.isActive) return;

    if (!settings.apiKey) {
      setSettingsOpen(true);
      setError("Please provide an OpenRouter API key to use the free AI agent.");
      return;
    }

    setError(null);
    setInput("");
    loadingRef.current = true;
    setLoading(true);

    try {
      const token = sessionToken ?? await getToken();
      if (token && !sessionToken) setSessionToken(token);
      const chatId = token && user ? await ensureChat(token) : null;

      const userMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: promptToSend,
        createdAt: new Date().toISOString(),
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      if (chatId && token) await persistMessage(chatId, userMsg, token);

      const response = await askAgent(promptToSend, nextMessages, tasks, habits, settings, notesStore.list(), notesStore.listFolders());
      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.reply,
        proposedTasks: response.tasks,
        proposedHabits: response.habits,
        proposedNotes: response.notes,
        proposedFolders: response.folders,
        actualModel: response.actualModel,
        createdAt: new Date().toISOString(),
      };
      setMessages([...nextMessages, assistantMsg]);
      if (chatId && token) await persistMessage(chatId, assistantMsg, token);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate tasks with AI";
      setError(msg);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function handleToggleImportant(messageId: string, taskId: string) {
    setMessages((prev) => updateTaskProposal(prev, messageId, taskId, (task) => ({ ...task, important: !task.important })));
  }

  function handleToggleUrgent(messageId: string, taskId: string) {
    setMessages((prev) => updateTaskProposal(prev, messageId, taskId, (task) => ({ ...task, urgent: !task.urgent })));
  }

  function handleToggleSelect(messageId: string, taskId: string) {
    setMessages((prev) => updateTaskProposal(prev, messageId, taskId, (task) => ({ ...task, selected: !task.selected })));
  }

  async function handleAddSingle(messageId: string, task: ProposedTask) {
    setAddingIds((prev) => ({ ...prev, [task.id]: true }));
    try {
      await onAddTasks([taskDraftOf(task)]);
      setMessages((prev) => markTasksAdded(prev, messageId, new Set([task.id])));
    } finally {
      setAddingIds((prev) => ({ ...prev, [task.id]: false }));
    }
  }

  async function handleAddAll(messageId: string, proposed: ProposedTask[]) {
    const toAdd = proposed.filter((task) => task.selected && !task.added);
    if (!toAdd.length) return;
    const ids = new Set(toAdd.map((task) => task.id));
    toAdd.forEach((task) => setAddingIds((prev) => ({ ...prev, [task.id]: true })));
    try {
      await onAddTasks(toAdd.map(taskDraftOf));
      setMessages((prev) => markTasksAdded(prev, messageId, ids));
    } finally {
      toAdd.forEach((task) => setAddingIds((prev) => ({ ...prev, [task.id]: false })));
    }
  }

  function updateProposedHabit(messageId: string, habitId: string, update: Partial<ProposedHabit>) {
    setMessages((prev) => updateHabitProposal(prev, messageId, habitId, update));
  }

  async function handleAddSingleHabit(messageId: string, habit: ProposedHabit) {
    setAddingIds((prev) => ({ ...prev, [habit.id]: true }));
    try {
      await onAddHabits([habitDraftOf(habit)]);
      updateProposedHabit(messageId, habit.id, { added: true });
    } finally {
      setAddingIds((prev) => ({ ...prev, [habit.id]: false }));
    }
  }

  async function handleAddAllHabits(messageId: string, proposed: ProposedHabit[]) {
    const toAdd = proposed.filter((habit) => habit.selected && !habit.added);
    if (!toAdd.length) return;
    const ids = new Set(toAdd.map((habit) => habit.id));
    toAdd.forEach((habit) => setAddingIds((prev) => ({ ...prev, [habit.id]: true })));
    try {
      await onAddHabits(toAdd.map(habitDraftOf));
      setMessages((prev) => markHabitsAdded(prev, messageId, ids));
    } finally {
      toAdd.forEach((habit) => setAddingIds((prev) => ({ ...prev, [habit.id]: false })));
    }
  }

  function updateProposedNote(messageId: string, noteId: string, update: Partial<ProposedNote>) {
    setMessages((prev) => updateNoteProposal(prev, messageId, noteId, update));
  }

  async function handleAddSingleNote(messageId: string, note: ProposedNote) {
    setAddingIds((prev) => ({ ...prev, [note.id]: true }));
    try {
      await onAddNotes([noteDraftOf(note)]);
      setMessages((prev) => markNotesAdded(prev, messageId, new Set([note.id])));
    } finally {
      setAddingIds((prev) => ({ ...prev, [note.id]: false }));
    }
  }

  async function handleAddAllNotes(messageId: string, proposed: ProposedNote[]) {
    const toAdd = proposed.filter((note) => note.selected && !note.added);
    if (!toAdd.length) return;
    const ids = new Set(toAdd.map((note) => note.id));
    toAdd.forEach((note) => setAddingIds((prev) => ({ ...prev, [note.id]: true })));
    try {
      await onAddNotes(toAdd.map(noteDraftOf));
      setMessages((prev) => markNotesAdded(prev, messageId, ids));
    } finally {
      toAdd.forEach((note) => setAddingIds((prev) => ({ ...prev, [note.id]: false })));
    }
  }

  function updateProposedFolder(messageId: string, folderId: string, update: Partial<ProposedFolder>) {
    setMessages((prev) => updateFolderProposal(prev, messageId, folderId, update));
  }

  async function handleAddSingleFolder(messageId: string, folder: ProposedFolder) {
    setAddingIds((prev) => ({ ...prev, [folder.id]: true }));
    try {
      await onAddFolders([folderDraftOf(folder)]);
      setMessages((prev) => markFoldersAdded(prev, messageId, new Set([folder.id])));
    } finally {
      setAddingIds((prev) => ({ ...prev, [folder.id]: false }));
    }
  }

  async function handleAddAllFolders(messageId: string, proposed: ProposedFolder[]) {
    const toAdd = proposed.filter((folder) => folder.selected && !folder.added);
    if (!toAdd.length) return;
    const ids = new Set(toAdd.map((folder) => folder.id));
    toAdd.forEach((folder) => setAddingIds((prev) => ({ ...prev, [folder.id]: true })));
    try {
      await onAddFolders(toAdd.map(folderDraftOf));
      setMessages((prev) => markFoldersAdded(prev, messageId, ids));
    } finally {
      toAdd.forEach((folder) => setAddingIds((prev) => ({ ...prev, [folder.id]: false })));
    }
  }

  const messageHandlers: AssistantMessageHandlers = {
    addingIds,
    onToggleTaskSelect: handleToggleSelect,
    onToggleTaskImportant: handleToggleImportant,
    onToggleTaskUrgent: handleToggleUrgent,
    onAddSingleTask: (messageId, task) => void handleAddSingle(messageId, task),
    onAddAllTasks: (messageId, tasks) => void handleAddAll(messageId, tasks),
    onUpdateHabit: updateProposedHabit,
    onAddSingleHabit: (messageId, habit) => void handleAddSingleHabit(messageId, habit),
    onAddAllHabits: (messageId, habits) => void handleAddAllHabits(messageId, habits),
    onUpdateNote: updateProposedNote,
    onAddSingleNote: (messageId, note) => void handleAddSingleNote(messageId, note),
    onAddAllNotes: (messageId, notes) => void handleAddAllNotes(messageId, notes),
    onUpdateFolder: updateProposedFolder,
    onAddSingleFolder: (messageId, folder) => void handleAddSingleFolder(messageId, folder),
    onAddAllFolders: (messageId, folders) => void handleAddAllFolders(messageId, folders),
  };

  if (!open) return null;

  return (
    <>
      {isOverlay && <div className="agent-overlay-backdrop" aria-hidden="true" onMouseDown={handleClose} />}
      <dialog ref={panelRef} id="prior-ai-assistant" open inert={inert} className={`agent-sidebar ${isOverlay ? "overlay" : "docked"}`} aria-labelledby="prior-ai-assistant-title" tabIndex={-1}>
      <header className="agent-header">
        <div className="agent-title-row">
          <AgentIdentity size="small" />
          <h3 id="prior-ai-assistant-title">AI Assistant</h3>
        </div>
        <div className="agent-header-actions">
          <button
            type="button"
            className="icon-button agent-new-chat"
            title="New conversation"
            aria-label="New conversation"
            onClick={startNewChat}
            disabled={dictation.isActive}
          >
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-button" aria-label="Close assistant" onClick={handleClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <button className="agent-history-toggle" type="button" aria-expanded={historyOpen} aria-controls="prior-chat-history" onClick={() => setHistoryOpen((value) => !value)}>
        <span>Chat history</span>
        <Icon name="chevron-down" />
      </button>
      <nav id="prior-chat-history" className="agent-chat-history" aria-label="Chat history" hidden={!historyOpen}>
        {historyLoading && <span className="agent-history-note">Loading chats…</span>}
        {!historyLoading && chatHistory.map((chat) => (
          <button
            key={chat.id}
            type="button"
            className={`agent-chat-item ${chat.id === activeChatId ? "active" : ""}`}
            aria-current={chat.id === activeChatId ? "page" : undefined}
            aria-label={chat.title}
            title={chat.title}
            onClick={() => void selectChat(chat.id)}
            disabled={chatLoading || loading || dictation.isActive}
          >
            <span>{chat.title}</span>
          </button>
        ))}
        {!historyLoading && !chatHistory.length && !user && <span className="agent-history-note">Sign in to save chats</span>}
      </nav>

      <div className="agent-body">
        {messages.length === 0 ? (
          <div className="agent-welcome">
            <div className="agent-welcome-visual" aria-hidden="true">
              <span className="agent-welcome-halo" />
              <AgentIdentity size="hero" />
            </div>
            <h4>What’s next?</h4>

            <div className="starter-prompts-grid">
              {STARTER_PROMPTS.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className="starter-chip"
                  disabled={dictation.isActive}
                  onClick={() => {
                    if (dictation.isActive) return;
                    if (item.prompt.endsWith(": ")) {
                      setInput(item.prompt);
                      textareaRef.current?.focus();
                    } else {
                      void handleSend(item.prompt);
                    }
                  }}
                >
                  <Icon name={item.icon} />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="agent-messages">
            {messages.map((msg) => (
              <AssistantMessage key={msg.id} message={msg} handlers={messageHandlers} />
            ))}

            {loading && (
              <div className="agent-message-row assistant">
                <div className="agent-message-avatar">
                  <AgentIdentity size="tiny" thinking />
                </div>
                <div className="agent-message-bubble loading-bubble" role="status" aria-live="polite">
                  <span className="loading-text">Thinking through your priorities…</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {error && (
        <div className="agent-error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <Icon name="close" />
          </button>
        </div>
      )}

      {settingsOpen && (
        <div className="agent-settings-panel">
          <h4>OpenRouter Settings</h4>
          <p className="settings-desc">
            Add your OpenRouter key and choose the model used by the assistant.
          </p>

          <div className="settings-search-toggle">
            <input id="prior-web-search" type="checkbox" checked={webSearchInput} onChange={(event) => setWebSearchInput(event.target.checked)} />
            <label htmlFor="prior-web-search">
              <strong>Web search when needed</strong>
              <small>Use it for current or niche information. Search provider costs may apply.</small>
            </label>
          </div>

          <label className="settings-field">
            <span>OpenRouter API Key</span>
            <div className="field">
              <Icon name="lock" />
              <input
                type={showApiKey ? "text" : "password"}
                placeholder="sk-or-v1-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              <button
                type="button"
                className="show-key-btn"
                onClick={() => setShowApiKey(!showApiKey)}
                tabIndex={-1}
              >
                {showApiKey ? "Hide" : "Show"}
              </button>
            </div>
            <small className="settings-help">
              Get a key at{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                openrouter.ai/keys
              </a>
            </small>
          </label>

          <div className="settings-field">
            <span>Model</span>
            <button type="button" className="model-picker-trigger" onClick={openModelModal} aria-haspopup="dialog">
              <span className="model-picker-name">{shortModelName(modelInput.trim() || DEFAULT_MODEL)}</span>
              <span className="model-picker-id">{modelInput.trim() || DEFAULT_MODEL}</span>
              <Icon name="chevron-down" />
            </button>
          </div>

          <div className="settings-footer">
            <button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveSettings}>
              Save
            </button>
          </div>
        </div>
      )}

      <footer className="agent-footer">
        <form
          className="agent-input-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            readOnly={dictation.isActive}
            title={dictation.isActive ? "Stop dictation to edit" : undefined}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Plan something…"
            rows={2}
          />
          <DictationPreview finalText={dictation.finalText} interimText={dictation.interimText} warning={dictation.warning} />
          <DictationStatusBar
            status={dictation.status}
            error={dictation.error}
            onCancel={cancelDictation}
            onDismissError={dictation.cancel}
          />
          <div className="agent-input-actions">
            <div className="agent-input-tools">
              <button
                type="button"
                className={`agent-settings-trigger ${!settings.apiKey ? "needs-key" : ""}`}
                title="AI settings"
                aria-label="AI settings"
                aria-expanded={settingsOpen}
                onClick={openSettings}
              >
                <Icon name="gear" />
                <span>{shortModelName(settings.model)}</span>
                {!settings.apiKey && <span className="settings-alert-dot" />}
              </button>
              {messages.length > 0 && (
                <button type="button" className="clear-chat-btn" title="Clear conversation" onClick={startNewChat} disabled={dictation.isActive}>
                  Clear
                </button>
              )}
            </div>
            <DictationControls
              status={dictation.status}
              onStart={startDictation}
              onStop={dictation.stop}
            />
            <button
              type="submit"
              className="primary-button agent-send-btn"
              disabled={!input.trim() || loading || dictation.isActive}
              aria-label="Send to AI assistant"
            >
              <Icon name="arrow" />
            </button>
          </div>
        </form>
      </footer>

      {modelModalOpen && (
        <div className="model-modal-layer">
          <div className="model-modal-backdrop" aria-hidden="true" onMouseDown={() => setModelModalOpen(false)} />
          <dialog className="model-modal" aria-labelledby="prior-model-modal-title" open>
            <header className="model-modal-header">
              <h4 id="prior-model-modal-title">Choose a model</h4>
              <button type="button" className="icon-button" aria-label="Close model picker" onClick={() => setModelModalOpen(false)}>
                <Icon name="close" />
              </button>
            </header>
            <div className="model-modal-search">
              <Icon name="search" />
              <input
                ref={modelSearchRef}
                type="search"
                value={modelSearch}
                aria-label="Search models"
                placeholder="Search free models…"
                onChange={(event) => setModelSearch(event.target.value)}
              />
            </div>
            <div className="model-modal-list" role="radiogroup" aria-label="Available models">
              {modelList
                .filter((m) => {
                  const query = modelSearch.trim().toLowerCase();
                  if (!query) return true;
                  return `${m.label} ${m.id}`.toLowerCase().includes(query);
                })
                .map((m) => {
                  const selected = !customDraft.trim() && listDraft === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`model-option ${selected ? "selected" : ""}`}
                      onClick={() => { setListDraft(m.id); setCustomDraft(""); }}
                    >
                      <span className="model-radio" aria-hidden="true" />
                      <span className="model-option-copy">
                        <strong>{m.label}</strong>
                        <small>{m.id}</small>
                        <small className="model-option-desc">{m.desc}</small>
                      </span>
                    </button>
                  );
                })}
              {!modelList.filter((m) => {
                const query = modelSearch.trim().toLowerCase();
                if (!query) return true;
                return `${m.label} ${m.id}`.toLowerCase().includes(query);
              }).length && <span className="agent-history-note">No models match “{modelSearch.trim()}”. Enter a custom ID below.</span>}
            </div>
            <label className="model-custom-field">
              <span>Or enter a custom model ID</span>
              <div className="field">
                <input
                  type="text"
                  placeholder="provider/model-name"
                  value={customDraft}
                  onChange={(event) => setCustomDraft(event.target.value)}
                />
              </div>
            </label>
            <div className="settings-footer">
              <button type="button" className="secondary-button" onClick={() => setModelModalOpen(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={confirmModelModal}>
                {modelConfirmLabel(customDraft, listDraft)}
              </button>
            </div>
          </dialog>
        </div>
      )}
      </dialog>
    </>
  );
}
