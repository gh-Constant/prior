import { useEffect, useRef, useState } from "react";
import type { AgentChatSummary, AgentMessage, AgentSettings, Habit, ProposedHabit, ProposedTask, QuadrantKey, Task, TaskDraft } from "../types";
import { askAgent, DEFAULT_MODEL, fetchAvailableFreeModels, getAgentSettings, POPULAR_FREE_MODELS, saveAgentSettings } from "../lib/ai";
import { getToken, type SessionUser } from "../lib/auth";
import { api } from "../lib/api";
import { habitScheduleLabel } from "../lib/habits";
import { quadrantFor } from "../lib/priority";
import "./AgentSidebar.css";
import { AgentIdentity } from "./AgentIdentity";
import { Icon } from "./Icon";

type Props = {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  habits: Habit[];
  user: SessionUser | null;
  onAddTasks: (tasks: TaskDraft[]) => Promise<void>;
  onAddHabits: (habits: Array<Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">>) => Promise<void>;
};

const STARTER_PROMPTS = [
  { icon: "bolt" as const, title: "Plan today's priorities", prompt: "Help me prioritize today. I need to focus on high-impact work and handle urgent deadlines first." },
  { icon: "inbox" as const, title: "Triage a brain dump", prompt: "Here is a brain dump of things on my mind: " },
  { icon: "plan" as const, title: "Break down a project", prompt: "Break down this project into atomic, actionable Eisenhower tasks with clear urgency and importance: " },
  { icon: "sparkles" as const, title: "Organize my inbox", prompt: "Review my current task list and suggest what to tackle first, what to schedule, and what to defer." },
];

function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function AgentSidebar({ open, onClose, tasks, habits, user, onAddTasks, onAddHabits }: Props) {
  const [settings, setSettings] = useState<AgentSettings>(() => getAgentSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey);
  const [modelInput, setModelInput] = useState(settings.model);
  const [webSearchInput, setWebSearchInput] = useState(settings.webSearch !== false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [modelList, setModelList] = useState(POPULAR_FREE_MODELS);
  const [customModelMode, setCustomModelMode] = useState(() => {
    return !POPULAR_FREE_MODELS.some((m) => m.id === settings.model);
  });

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    void fetchAvailableFreeModels().then((list) => {
      if (list && list.length) setModelList(list);
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
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (settingsOpen) setSettingsOpen(false); else onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea, input:not(:disabled), select:not(:disabled), a[href]'
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
  }, [open, onClose, settingsOpen]);

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
    if (!sessionToken || chatId === activeChatId || chatLoading || loading) return;
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
    if (loading || chatLoading) return;
    setActiveChatId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setSettingsOpen(false);
  }

  async function handleSend(customPrompt?: string) {
    const promptToSend = (customPrompt ?? input).trim();
    if (!promptToSend || loadingRef.current) return;

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

      const response = await askAgent(promptToSend, nextMessages, tasks, habits, settings);
      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.reply,
        proposedTasks: response.tasks,
        proposedHabits: response.habits,
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
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.proposedTasks) return msg;
        return {
          ...msg,
          proposedTasks: msg.proposedTasks.map((t) => (t.id === taskId ? { ...t, important: !t.important } : t)),
        };
      }),
    );
  }

  function handleToggleUrgent(messageId: string, taskId: string) {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.proposedTasks) return msg;
        return {
          ...msg,
          proposedTasks: msg.proposedTasks.map((t) => (t.id === taskId ? { ...t, urgent: !t.urgent } : t)),
        };
      }),
    );
  }

  function handleToggleSelect(messageId: string, taskId: string) {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.proposedTasks) return msg;
        return {
          ...msg,
          proposedTasks: msg.proposedTasks.map((t) => (t.id === taskId ? { ...t, selected: !t.selected } : t)),
        };
      }),
    );
  }

  async function handleAddSingle(messageId: string, task: ProposedTask) {
    setAddingIds((prev) => ({ ...prev, [task.id]: true }));
    try {
      await onAddTasks([{ title: task.title, description: task.description, dueDate: task.dueDate, priority: task.priority, important: task.important, urgent: task.urgent }]);
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId || !msg.proposedTasks) return msg;
          return {
            ...msg,
            proposedTasks: msg.proposedTasks.map((t) => (t.id === task.id ? { ...t, added: true } : t)),
          };
        }),
      );
    } finally {
      setAddingIds((prev) => ({ ...prev, [task.id]: false }));
    }
  }

  async function handleAddAll(messageId: string, proposed: ProposedTask[]) {
    const toAdd = proposed.filter((t) => t.selected && !t.added);
    if (!toAdd.length) return;

    toAdd.forEach((t) => setAddingIds((prev) => ({ ...prev, [t.id]: true })));
    try {
      await onAddTasks(toAdd.map((t) => ({ title: t.title, description: t.description, dueDate: t.dueDate, priority: t.priority, important: t.important, urgent: t.urgent })));
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId || !msg.proposedTasks) return msg;
          const ids = new Set(toAdd.map((t) => t.id));
          return {
            ...msg,
            proposedTasks: msg.proposedTasks.map((t) => (ids.has(t.id) ? { ...t, added: true } : t)),
          };
        }),
      );
    } finally {
      toAdd.forEach((t) => setAddingIds((prev) => ({ ...prev, [t.id]: false })));
    }
  }

  function updateProposedHabit(messageId: string, habitId: string, update: Partial<ProposedHabit>) {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || !message.proposedHabits) return message;
      return {
        ...message,
        proposedHabits: message.proposedHabits.map((habit) => habit.id === habitId ? { ...habit, ...update } : habit),
      };
    }));
  }

  async function handleAddSingleHabit(messageId: string, habit: ProposedHabit) {
    setAddingIds((prev) => ({ ...prev, [habit.id]: true }));
    try {
      await onAddHabits([{ title: habit.title, important: habit.important, urgent: habit.urgent, interval: habit.interval, unit: habit.unit }]);
      updateProposedHabit(messageId, habit.id, { added: true });
    } finally {
      setAddingIds((prev) => ({ ...prev, [habit.id]: false }));
    }
  }

  async function handleAddAllHabits(messageId: string, proposed: ProposedHabit[]) {
    const toAdd = proposed.filter((habit) => habit.selected && !habit.added);
    if (!toAdd.length) return;

    toAdd.forEach((habit) => setAddingIds((prev) => ({ ...prev, [habit.id]: true })));
    try {
      await onAddHabits(toAdd.map((habit) => ({ title: habit.title, important: habit.important, urgent: habit.urgent, interval: habit.interval, unit: habit.unit })));
      const ids = new Set(toAdd.map((habit) => habit.id));
      setMessages((prev) => prev.map((message) => {
        if (message.id !== messageId || !message.proposedHabits) return message;
        return { ...message, proposedHabits: message.proposedHabits.map((habit) => ids.has(habit.id) ? { ...habit, added: true } : habit) };
      }));
    } finally {
      toAdd.forEach((habit) => setAddingIds((prev) => ({ ...prev, [habit.id]: false })));
    }
  }

  function getQuadrantBadge(task: Pick<Task, "important" | "urgent">): { key: QuadrantKey; label: string } {
    const key = quadrantFor(task);
    switch (key) {
      case "focus":
        return { key, label: "Focus (Do First)" };
      case "plan":
        return { key, label: "Plan (Schedule)" };
      case "quick":
        return { key, label: "Quick (Delegate)" };
      case "later":
        return { key, label: "Later (Eliminate)" };
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="agent-overlay-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <aside ref={panelRef} id="prior-ai-assistant" className="agent-sidebar" role="dialog" aria-modal="true" aria-labelledby="prior-ai-assistant-title" tabIndex={-1}>
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
          >
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-button" aria-label="Close assistant" onClick={onClose}>
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
            disabled={chatLoading || loading}
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
              {STARTER_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="starter-chip"
                  onClick={() => {
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
              <div key={msg.id} className={`agent-message-row ${msg.role}`}>
                {msg.role === "assistant" && (
                  <div className="agent-message-avatar">
                    <AgentIdentity size="tiny" />
                  </div>
                )}
                <div className="agent-message-bubble">
                  <p className="agent-message-text">{msg.content}</p>

                  {msg.actualModel && (
                    <div className="agent-model-info" title={`Resolved via OpenRouter: ${msg.actualModel}`}>
                      <span className="routed-dot" />
                      <span>Model: <strong>{msg.actualModel}</strong></span>
                    </div>
                  )}

                  {msg.proposedTasks && msg.proposedTasks.length > 0 && (
                    <div className="proposed-tasks-box">
                      <div className="proposed-tasks-header">
                        <span className="proposed-count">
                          {msg.proposedTasks.filter((t) => t.added).length}/{msg.proposedTasks.length} added
                        </span>
                        {msg.proposedTasks.some((t) => !t.added) && (
                          <button
                            type="button"
                            className="primary-button add-all-btn"
                            onClick={() => void handleAddAll(msg.id, msg.proposedTasks!)}
                          >
                            <Icon name="plus" />
                            <span>Add all to Prior</span>
                          </button>
                        )}
                      </div>

                      <div className="proposed-task-list">
                        {msg.proposedTasks.map((t) => {
                          const badge = getQuadrantBadge(t);
                          const priority = t.priority ?? 4;
                          const isAdding = addingIds[t.id];
                          return (
                            <div key={t.id} className={`proposed-task-item ${t.added ? "is-added" : ""}`}>
                              <div className="proposed-task-top">
                                <label className="proposed-checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={t.selected}
                                    disabled={t.added}
                                    onChange={() => handleToggleSelect(msg.id, t.id)}
                                  />
                                  <span className="proposed-task-title">{t.title}</span>
                                </label>

                                {t.added ? (
                                  <span className="task-added-badge">
                                    <Icon name="check" /> Added
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="add-single-btn"
                                    disabled={isAdding}
                                    onClick={() => void handleAddSingle(msg.id, t)}
                                    title="Add task to Prior"
                                  >
                                    <Icon name="plus" />
                                  </button>
                                )}
                              </div>

                              {t.description && <p className="proposed-description">{t.description}</p>}
                              <div className="proposed-task-meta">
                                <span className={`quadrant-chip quadrant-chip-${badge.key}`}>
                                  {badge.label}
                                </span>
                                <span className={`proposed-priority proposed-priority-${priority}`}>P{priority}</span>
                                {t.dueDate && <span className="proposed-due-date">Due {formatDueDate(t.dueDate)}</span>}

                                <div className="proposed-toggles">
                                  <button
                                    type="button"
                                    className={`task-action flag-toggle ${t.important ? "active important" : ""}`}
                                    aria-label={t.important ? "Remove important flag" : "Mark important"}
                                    aria-pressed={t.important}
                                    title={t.important ? "Important (Click to change)" : "Not Important (Click to mark Important)"}
                                    disabled={t.added}
                                    onClick={() => handleToggleImportant(msg.id, t.id)}
                                  >
                                    <Icon name="star" />
                                  </button>
                                  <button
                                    type="button"
                                    className={`task-action flag-toggle ${t.urgent ? "active urgent" : ""}`}
                                    aria-label={t.urgent ? "Remove urgent flag" : "Mark urgent"}
                                    aria-pressed={t.urgent}
                                    title={t.urgent ? "Urgent (Click to change)" : "Not Urgent (Click to mark Urgent)"}
                                    disabled={t.added}
                                    onClick={() => handleToggleUrgent(msg.id, t.id)}
                                  >
                                    <Icon name="bolt" />
                                  </button>
                                </div>
                              </div>

                              {t.reasoning && <p className="proposed-reasoning">{t.reasoning}</p>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {msg.proposedHabits && msg.proposedHabits.length > 0 && (
                    <div className="proposed-tasks-box proposed-habits-box">
                      <div className="proposed-tasks-header">
                        <span className="proposed-count">
                          {msg.proposedHabits.filter((habit) => habit.added).length}/{msg.proposedHabits.length} habits added
                        </span>
                        {msg.proposedHabits.some((habit) => !habit.added) && (
                          <button
                            type="button"
                            className="primary-button add-all-btn"
                            onClick={() => void handleAddAllHabits(msg.id, msg.proposedHabits!)}
                          >
                            <Icon name="plus" />
                            <span>Add habits to Prior</span>
                          </button>
                        )}
                      </div>

                      <div className="proposed-task-list">
                        {msg.proposedHabits.map((habit) => {
                          const badge = getQuadrantBadge(habit);
                          const isAdding = addingIds[habit.id];
                          return (
                            <div key={habit.id} className={`proposed-task-item ${habit.added ? "is-added" : ""}`}>
                              <div className="proposed-task-top">
                                <label className="proposed-checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={habit.selected}
                                    disabled={habit.added}
                                    onChange={() => updateProposedHabit(msg.id, habit.id, { selected: !habit.selected })}
                                  />
                                  <span className="proposed-task-title">{habit.title}</span>
                                </label>

                                {habit.added ? (
                                  <span className="task-added-badge">
                                    <Icon name="check" /> Added
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="add-single-btn"
                                    disabled={isAdding}
                                    onClick={() => void handleAddSingleHabit(msg.id, habit)}
                                    title="Add habit to Prior"
                                  >
                                    <Icon name="plus" />
                                  </button>
                                )}
                              </div>

                              <div className="proposed-task-meta">
                                <span className={`quadrant-chip quadrant-chip-${badge.key}`}>
                                  {habitScheduleLabel(habit)} · {badge.label}
                                </span>

                                <div className="proposed-toggles">
                                  <button
                                    type="button"
                                    className={`task-action flag-toggle ${habit.important ? "active important" : ""}`}
                                    aria-label={habit.important ? "Remove important flag" : "Mark important"}
                                    aria-pressed={habit.important}
                                    title={habit.important ? "Important (Click to change)" : "Not Important (Click to mark Important)"}
                                    disabled={habit.added}
                                    onClick={() => updateProposedHabit(msg.id, habit.id, { important: !habit.important })}
                                  >
                                    <Icon name="star" />
                                  </button>
                                  <button
                                    type="button"
                                    className={`task-action flag-toggle ${habit.urgent ? "active urgent" : ""}`}
                                    aria-label={habit.urgent ? "Remove urgent flag" : "Mark urgent"}
                                    aria-pressed={habit.urgent}
                                    title={habit.urgent ? "Urgent (Click to change)" : "Not Urgent (Click to mark Urgent)"}
                                    disabled={habit.added}
                                    onClick={() => updateProposedHabit(msg.id, habit.id, { urgent: !habit.urgent })}
                                  >
                                    <Icon name="bolt" />
                                  </button>
                                </div>
                              </div>

                              {habit.reasoning && <p className="proposed-reasoning">{habit.reasoning}</p>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
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

          <label className="settings-search-toggle">
            <input type="checkbox" checked={webSearchInput} onChange={(event) => setWebSearchInput(event.target.checked)} />
            <span>
              <strong>Web search when needed</strong>
              <small>Use it for current or niche information. Search provider costs may apply.</small>
            </span>
          </label>

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

          <label className="settings-field">
            <div className="model-label-row">
              <span>Model</span>
              <button
                type="button"
                className="custom-model-toggle-btn"
                onClick={() => setCustomModelMode(!customModelMode)}
              >
                {customModelMode ? "Use model list" : "Custom ID"}
              </button>
            </div>

            {customModelMode ? (
              <div className="field">
                <input
                  type="text"
                  placeholder="openrouter/free"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                />
              </div>
            ) : (
              <div className="filter-control">
                <select
                  value={modelList.some((m) => m.id === modelInput) ? modelInput : "custom"}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setCustomModelMode(true);
                    } else {
                      setModelInput(e.target.value);
                    }
                  }}
                >
                  {modelList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  <option value="custom">Enter custom model ID…</option>
                </select>
              </div>
            )}
          </label>

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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Plan something…"
            rows={2}
          />
          <div className="agent-input-actions">
            <div className="agent-input-tools">
              <button
                type="button"
                className={`agent-settings-trigger ${!settings.apiKey ? "needs-key" : ""}`}
                title="AI settings"
                aria-label="AI settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                <Icon name="gear" />
                <span>{settings.model === DEFAULT_MODEL ? "Free model" : settings.model.split("/").pop()?.replace(":free", "") || settings.model}</span>
                {!settings.apiKey && <span className="settings-alert-dot" />}
              </button>
              {messages.length > 0 && (
                <button type="button" className="clear-chat-btn" title="Clear conversation" onClick={startNewChat}>
                  Clear
                </button>
              )}
            </div>
            <button
              type="submit"
              className="primary-button agent-send-btn"
              disabled={!input.trim() || loading}
              aria-label="Send to AI assistant"
            >
              <Icon name="arrow" />
            </button>
          </div>
        </form>
      </footer>
      </aside>
    </>
  );
}
