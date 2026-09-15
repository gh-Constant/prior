import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, AgentSettings, ProposedTask, QuadrantKey, Task } from "../types";
import { askAgent, DEFAULT_MODEL, fetchAvailableFreeModels, getAgentSettings, POPULAR_FREE_MODELS, saveAgentSettings } from "../lib/ai";
import { quadrantFor } from "../lib/priority";
import { Icon } from "./Icon";

type Props = {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  onAddTasks: (tasks: Array<Pick<Task, "title" | "important" | "urgent">>) => Promise<void>;
};

const STARTER_PROMPTS = [
  { icon: "bolt" as const, title: "Plan today's priorities", prompt: "Help me prioritize today. I need to focus on high-impact work and handle urgent deadlines first." },
  { icon: "inbox" as const, title: "Triage a brain dump", prompt: "Here is a brain dump of things on my mind: " },
  { icon: "plan" as const, title: "Break down a project", prompt: "Break down this project into atomic, actionable Eisenhower tasks with clear urgency and importance: " },
  { icon: "sparkles" as const, title: "Organize my inbox", prompt: "Review my current task list and suggest what to tackle first, what to schedule, and what to defer." },
];

export function AgentSidebar({ open, onClose, tasks, onAddTasks }: Props) {
  const [settings, setSettings] = useState<AgentSettings>(() => getAgentSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey);
  const [modelInput, setModelInput] = useState(settings.model);
  const [showApiKey, setShowApiKey] = useState(false);

  const [modelList, setModelList] = useState(POPULAR_FREE_MODELS);
  const [customModelMode, setCustomModelMode] = useState(() => {
    return !POPULAR_FREE_MODELS.some((m) => m.id === settings.model);
  });

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetchAvailableFreeModels().then((list) => {
      if (list && list.length) setModelList(list);
    });
  }, []);

  const lastActualModel = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].actualModel) return messages[i].actualModel;
    }
    return undefined;
  }, [messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleSaveSettings() {
    const updated: AgentSettings = {
      apiKey: apiKeyInput.trim(),
      model: modelInput.trim() || DEFAULT_MODEL,
    };
    setSettings(updated);
    saveAgentSettings(updated);
    setSettingsOpen(false);
    setError(null);
  }

  async function handleSend(customPrompt?: string) {
    const promptToSend = (customPrompt ?? input).trim();
    if (!promptToSend || loading) return;

    if (!settings.apiKey) {
      setSettingsOpen(true);
      setError("Please provide an OpenRouter API key to use the free AI agent.");
      return;
    }

    setError(null);
    setInput("");

    const userMsg: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: promptToSend,
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const response = await askAgent(promptToSend, nextMessages, tasks, settings);
      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.reply,
        proposedTasks: response.tasks,
        actualModel: response.actualModel,
        createdAt: new Date().toISOString(),
      };
      setMessages([...nextMessages, assistantMsg]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate tasks with AI";
      setError(msg);
    } finally {
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
      await onAddTasks([{ title: task.title, important: task.important, urgent: task.urgent }]);
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
      await onAddTasks(toAdd.map((t) => ({ title: t.title, important: t.important, urgent: t.urgent })));
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
    <aside className="agent-sidebar" aria-label="AI Task Assistant">
      <header className="agent-header">
        <div className="agent-title-row">
          <div className="agent-badge-icon" aria-hidden="true">
            <Icon name="sparkles" />
          </div>
          <div className="agent-title-text">
            <h3>AI Assistant</h3>
            <span
              className="agent-model-tag"
              title={`Configured: ${settings.model}${lastActualModel ? `\nResolved model: ${lastActualModel}` : ""}`}
            >
              {settings.model === DEFAULT_MODEL
                ? lastActualModel
                  ? `free → ${lastActualModel.split("/").pop()?.replace(":free", "")}`
                  : "openrouter/free"
                : settings.model.split("/").pop()?.replace(":free", "") || settings.model}
            </span>
          </div>
        </div>
        <div className="agent-header-actions">
          <button
            type="button"
            className={`icon-button agent-gear-btn ${!settings.apiKey ? "needs-key" : ""}`}
            title="AI Settings"
            aria-label="AI Settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <Icon name="gear" />
            {!settings.apiKey && <span className="settings-alert-dot" />}
          </button>
          <button type="button" className="icon-button" aria-label="Close assistant" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="agent-settings-panel">
          <h4>OpenRouter Settings</h4>
          <p className="settings-desc">
            Provide your own OpenRouter key and pick a model. By default, <code>openrouter/free</code> routes to free models and reveals the active model used.
          </p>

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
              Don't have a key? Get one free in 10s at{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                openrouter.ai/keys
              </a>
            </small>
          </label>

          <label className="settings-field">
            <div className="model-label-row">
              <span>Model Selection (Default: openrouter/free)</span>
              <button
                type="button"
                className="custom-model-toggle-btn"
                onClick={() => setCustomModelMode(!customModelMode)}
              >
                {customModelMode ? "Select from list" : "Custom model ID"}
              </button>
            </div>

            {customModelMode ? (
              <div className="field">
                <input
                  type="text"
                  placeholder="e.g. openrouter/free, openai/gpt-4o-mini"
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
                  <option value="custom">✏️ Enter custom model ID...</option>
                </select>
              </div>
            )}
            <small className="settings-help">
              By default, <code>openrouter/free</code> auto-routes to available free models and displays the active model for every response.
            </small>
          </label>

          <div className="settings-footer">
            <button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveSettings}>
              Save Settings
            </button>
          </div>
        </div>
      )}

      <div className="agent-body">
        {messages.length === 0 ? (
          <div className="agent-welcome">
            <div className="welcome-mark">
              <Icon name="sparkles" />
            </div>
            <h4>Prioritize effortlessly</h4>
            <p>
              Paste unstructured notes, plan a project, or dump your thoughts. The AI will automatically assign urgency and importance to organize your board.
            </p>

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
                  <div className="agent-message-avatar" aria-hidden="true">
                    <Icon name="sparkles" />
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

                              <div className="proposed-task-meta">
                                <span className={`quadrant-chip quadrant-chip-${badge.key}`}>
                                  {badge.label}
                                </span>

                                <div className="proposed-toggles">
                                  <button
                                    type="button"
                                    className={`task-action ${t.important ? "active important" : ""}`}
                                    title={t.important ? "Important (Click to change)" : "Not Important (Click to mark Important)"}
                                    disabled={t.added}
                                    onClick={() => handleToggleImportant(msg.id, t.id)}
                                  >
                                    <Icon name="star" />
                                  </button>
                                  <button
                                    type="button"
                                    className={`task-action ${t.urgent ? "active urgent" : ""}`}
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
                </div>
              </div>
            ))}

            {loading && (
              <div className="agent-message-row assistant">
                <div className="agent-message-avatar" aria-hidden="true">
                  <Icon name="sparkles" />
                </div>
                <div className="agent-message-bubble loading-bubble">
                  <div className="agent-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="loading-text">Triaging tasks & assessing Eisenhower matrix...</span>
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
            placeholder="Tell me what you need to do, paste notes, or ask for a plan..."
            rows={2}
          />
          <div className="agent-input-actions">
            {messages.length > 0 && (
              <button
                type="button"
                className="clear-chat-btn"
                title="Clear conversation"
                onClick={() => setMessages([])}
              >
                Clear
              </button>
            )}
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
  );
}
