import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentChatSummary,
  AgentMessage,
  AgentSettings,
  Area,
  Habit,
  HabitDraft,
  NoteDraft,
  NoteFolderDraft,
  Project,
  ProjectStatus,
  ProposedArea,
  ProposedFolder,
  ProposedHabit,
  ProposedNote,
  ProposedProject,
  ProposedTask,
  Task,
  TaskDraft,
} from "../types";
import { askAgent, askAgentStream, AGENT_SETTINGS_EVENT, DEFAULT_MODEL, fetchAvailableModels, getAgentSettings, modelSupportsReasoning, normalizeReasoningEffort, notifyAgentSettingsChanged, POPULAR_FREE_MODELS, REASONING_EFFORTS, saveAgentSettings, type AgentModelOption } from "../lib/ai";
import { fetchCodexModels, getCachedCodexAccount, supportsCodexDesktop, type CodexModelOption } from "../lib/codex";
import { getToken, handleAuthError, type SessionUser } from "../lib/auth";
import { api, isAuthError } from "../lib/api";
import { pendingChats, queueAgentMessage, syncAgentOutbox } from "../lib/agentOutbox";
import { getAccountId } from "../lib/accountScope";
import { generateUuid } from "../lib/uuid";
import "./AgentSidebar.css";
import { AgentIdentity } from "./AgentIdentity";
import {
  AssistantMessage,
  areaDraftOf,
  folderDraftOf,
  habitDraftOf,
  markAreasAdded,
  markFoldersAdded,
  markHabitsAdded,
  markNotesAdded,
  markProjectsAdded,
  markTasksAdded,
  noteDraftOf,
  projectDraftOf,
  taskDraftOf,
  updateAreaProposal,
  updateFolderProposal,
  updateHabitProposal,
  updateNoteProposal,
  updateProjectProposal,
  updateTaskProposal,
  type AssistantMessageHandlers,
} from "./AgentMessageView";
import { notesStore } from "../lib/notes";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import { DictationControls, DictationPreview, DictationStatusBar } from "./DictationControls";
import { useDictation } from "../hooks/useDictation";

function withPendingChats(chats: AgentChatSummary[]): AgentChatSummary[] {
  const known = new Set(chats.map((chat) => chat.id));
  const now = new Date().toISOString();
  return [...pendingChats().filter((chat) => !known.has(chat.id)).map((chat) => ({ id: chat.id, title: chat.title, createdAt: chat.messages[0]?.createdAt ?? now, updatedAt: now, messageCount: chat.messages.length })), ...chats];
}

/* Added-proposal flags are client-side only (the server stores the proposal
 * as first suggested), so they are remembered locally. Without this, closing
 * and reopening the assistant resets every card to "not added" and the user
 * can accidentally create everything twice. */
const ADDED_PROPOSALS_KEY = "prior.agent.added.v1";
const MAX_ADDED_PROPOSALS = 1000;

function loadAddedProposalIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ADDED_PROPOSALS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberAddedProposals(ids: ReadonlySet<string> | readonly string[]): void {
  const list = [...ids];
  if (!list.length) return;
  try {
    const next = loadAddedProposalIds();
    for (const id of list) next.add(id);
    localStorage.setItem(ADDED_PROPOSALS_KEY, JSON.stringify([...next].slice(-MAX_ADDED_PROPOSALS)));
  } catch {
    // Storage unavailable: flags still apply for this session.
  }
}

function withPersistedAddedFlags(messages: AgentMessage[]): AgentMessage[] {
  const added = loadAddedProposalIds();
  if (!added.size) return messages;
  const mark = <T extends { id: string; added?: boolean }>(items: T[] | undefined): T[] | undefined =>
    items?.map((item) => added.has(item.id) && !item.added ? { ...item, added: true } : item);
  return messages.map((message) => ({
    ...message,
    proposedAreas: mark(message.proposedAreas),
    proposedProjects: mark(message.proposedProjects),
    proposedTasks: mark(message.proposedTasks),
    proposedHabits: mark(message.proposedHabits),
    proposedNotes: mark(message.proposedNotes),
    proposedFolders: mark(message.proposedFolders),
  }));
}

type Props = {
  readonly open: boolean;
  readonly inert?: boolean;
  readonly onClose: () => void;
  readonly tasks: Task[];
  readonly habits: Habit[];
  readonly areas: Area[];
  readonly projects: Project[];
  readonly user: SessionUser | null;
  readonly onAddTasks: (tasks: Array<TaskDraft & { areaName?: string | null; projectName?: string | null }>) => Promise<void>;
  readonly onAddHabits: (habits: HabitDraft[]) => Promise<void>;
  readonly onAddNotes: (notes: NoteDraft[]) => Promise<void>;
  readonly onAddFolders: (folders: NoteFolderDraft[]) => Promise<void>;
  readonly onAddAreas?: (areas: Array<{ name: string; color?: string; icon?: string | null }>) => Promise<void>;
  readonly onAddProjects?: (projects: Array<{ name: string; areaName?: string | null; description?: string; status?: ProjectStatus; targetDate?: string | null; icon?: string | null }>) => Promise<void>;
  readonly onOpenSettings: () => void;
};

type StarterPrompt = { readonly icon: "sparkles" | "folder" | "bolt" | "user" | "inbox"; readonly title: string; readonly prompt: string };

function useStarterPrompts(): StarterPrompt[] {
  const { t } = useI18n();
  return useMemo(() => [
    { icon: "sparkles" as const, title: t("agent.suggest.setup.title"), prompt: t("agent.suggest.setup.prompt") },
    { icon: "folder" as const, title: t("agent.suggest.organize.title"), prompt: t("agent.suggest.organize.prompt") },
    { icon: "bolt" as const, title: t("agent.suggest.today.title"), prompt: t("agent.suggest.today.prompt") },
    { icon: "user" as const, title: t("agent.suggest.delegate.title"), prompt: t("agent.suggest.delegate.prompt") },
    { icon: "inbox" as const, title: t("agent.suggest.inbox.title"), prompt: t("agent.suggest.inbox.prompt") },
  ], [t]);
}

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

function shortModelName(id: string, freeLabel: string): string {
  if (id === DEFAULT_MODEL) return freeLabel;
  return id.split("/").pop()?.replace(":free", "") || id;
}

export function AgentSidebar({ open, inert, onClose, tasks, habits, areas, projects, user, onAddTasks, onAddHabits, onAddNotes, onAddFolders, onAddAreas, onAddProjects, onOpenSettings }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AgentSettings>(() => getAgentSettings());
  const starterPrompts = useStarterPrompts();

  const [modelList, setModelList] = useState<AgentModelOption[]>(POPULAR_FREE_MODELS);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [codexModelList, setCodexModelList] = useState<CodexModelOption[]>([]);
  const [codexModelsLoading, setCodexModelsLoading] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [reasoningPickerOpen, setReasoningPickerOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [chatHistory, setChatHistory] = useState<AgentChatSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [codexThreadId, setCodexThreadId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Record<string, boolean>>({});
  const [dictationLanguage] = useState(() => typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const reasoningPickerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
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
    void fetchAvailableModels().then((list) => {
      if (list?.length) setModelList(list);
    }).finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    if (!supportsCodexDesktop() || settings.provider !== "codex") return undefined;
    // Lazy: only hit the Codex server when the user opted into Codex AND has
    // a fresh cached login. Otherwise opening the sidebar must not spawn it.
    if (!getCachedCodexAccount()?.authenticated) return undefined;
    let cancelled = false;
    setCodexModelsLoading(true);
    void fetchCodexModels()
      .then((list) => {
        if (cancelled) return;
        setCodexModelList(list);
        const defaultModel = list.find((model) => model.isDefault)?.id ?? list[0]?.id;
        const current = getAgentSettings();
        if (defaultModel && !current.codexModel) {
          const updated = { ...current, codexModel: defaultModel };
          saveAgentSettings(updated);
          setSettings(updated);
          notifyAgentSettingsChanged();
        }
      })
      .finally(() => {
        if (!cancelled) setCodexModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, [settings.provider]);

  useEffect(() => {
    if (!modelPickerOpen && !reasoningPickerOpen) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(event.target as Node)) setModelPickerOpen(false);
      if (reasoningPickerRef.current && !reasoningPickerRef.current.contains(event.target as Node)) setReasoningPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModelPickerOpen(false);
        setReasoningPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelPickerOpen, reasoningPickerOpen]);

  useEffect(() => {
    // The API key and web search live in Settings now: reload whenever the
    // sidebar opens or Settings saves new values.
    if (open) setSettings(getAgentSettings());
    const reload = () => {
      const next = getAgentSettings();
      setSettings(next);
      if (next.provider !== "codex") setCodexThreadId(null);
    };
    window.addEventListener(AGENT_SETTINGS_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(AGENT_SETTINGS_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (!open || !user) {
      if (!user) {
        setSessionToken(null);
        setChatHistory([]);
        setActiveChatId(null);
        setCodexThreadId(null);
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
        try {
          const chats = await api.listAgentChats(token);
          if (!cancelled) setChatHistory(withPendingChats(chats));
        } catch (error) {
          if (await handleAuthError(error)) {
            if (!cancelled) {
              setError(t("agent.error.sessionExpired"));
              setChatHistory([]);
            }
            return;
          }
          throw error;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (isAuthError(error)) setError(t("agent.error.sessionExpired"));
          setChatHistory(withPendingChats([]));
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, user]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    const account = getAccountId();
    const refreshHistory = async () => {
      try {
        const token = await getToken();
        if (!token || cancelled || account !== getAccountId()) return;
        const chats = await api.listAgentChats(token);
        if (cancelled || account !== getAccountId()) return;
        setChatHistory(withPendingChats(chats));
        if (!activeChatId || loadingRef.current) return;
        const chat = await api.getAgentChat(activeChatId, token);
        if (!cancelled && account === getAccountId() && !loadingRef.current && !pendingChats().some((item) => item.id === activeChatId)) setMessages(withPersistedAddedFlags(chat.messages ?? []));
      } catch { /* The next sync retries; current messages stay visible. */ }
    };
    window.addEventListener("prior-sync-complete", refreshHistory);
    return () => { cancelled = true; window.removeEventListener("prior-sync-complete", refreshHistory); };
  }, [open, user, activeChatId]);

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
        if (dictation.isActive) {
          cancelDictation();
          return;
        }
        onClose();
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
  }, [dictation, open, onClose, isOverlay]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => () => {
    // Abort any in-flight Codex stream on unmount so turnId refs never leak.
    abortRef.current?.abort();
    abortRef.current = null;
    loadingRef.current = false;
  }, []);

  useEffect(() => {
    // Hydrate $…$ / $$…$$ spans left by the chat markdown renderer.
    if (!open || !panelRef.current) return undefined;
    let cancelled = false;
    const targets = Array.from(panelRef.current.querySelectorAll<HTMLElement>(".chat-math:not([data-rendered])"));
    if (!targets.length) return undefined;
    void import("katex").then((katexModule) => {
      if (cancelled) return;
      const katex = katexModule.default;
      targets.forEach((element) => {
        try {
          katex.render(element.textContent ?? "", element, { displayMode: element.classList.contains("chat-math-display"), throwOnError: false });
          element.dataset.rendered = "true";
        } catch {
          // Keep the raw source readable when KaTeX cannot parse it.
        }
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [messages, open, loading]);

  function handleModelChange(model: string): void {
    const updated: AgentSettings = settings.provider === "codex"
      ? { ...settings, codexModel: model }
      : { ...settings, model: model || DEFAULT_MODEL };
    setSettings(updated);
    saveAgentSettings(updated);
    notifyAgentSettingsChanged();
  }

  function handleReasoningChange(effort: string): void {
    const updated: AgentSettings = { ...settings, reasoningEffort: normalizeReasoningEffort(effort) };
    setSettings(updated);
    saveAgentSettings(updated);
    notifyAgentSettingsChanged();
  }

  function handleClose(): void {
    dictation.stop();
    onClose();
  }

  const activeModelId = settings.provider === "codex"
    ? settings.codexModel ?? ""
    : settings.model;
  const providerModelOptions = useMemo<AgentModelOption[]>(() => settings.provider === "codex"
    ? codexModelList.map((model) => ({ id: model.id, label: model.label, desc: model.description }))
    : modelList, [codexModelList, modelList, settings.provider]);
  const modelOptions = useMemo(() => {
    if (!activeModelId || providerModelOptions.some((model) => model.id === activeModelId)) return providerModelOptions;
    return [...providerModelOptions, {
      id: activeModelId,
      label: shortModelName(activeModelId, t("agent.model.free")),
      desc: settings.provider === "codex" ? t("agent.model.customCodex") : t("agent.model.customSettings"),
    }];
  }, [activeModelId, providerModelOptions, settings.provider, t]);
  const deferredModelQuery = useDeferredValue(modelQuery.trim().toLowerCase());
  const filteredModelOptions = useMemo(() => {
    if (!deferredModelQuery) return modelOptions.slice(0, 80);
    return modelOptions.filter((model) => `${model.label} ${model.id} ${model.desc}`.toLowerCase().includes(deferredModelQuery)).slice(0, 80);
  }, [deferredModelQuery, modelOptions]);
  const selectedModel = modelOptions.find((model) => model.id === activeModelId) ?? modelOptions[0];
  // Reasoning control: always offered for Codex (ChatGPT subscription
  // models honor modelReasoningEffort); for OpenRouter only when the catalog
  // entry or the model id advertises reasoning support.
  const showReasoning = settings.provider === "codex"
    || (selectedModel ? modelSupportsReasoning(selectedModel) : false);
  const activeReasoning = normalizeReasoningEffort(settings.reasoningEffort);

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

  async function ensureChat(): Promise<string | null> {
    if (activeChatId) return activeChatId;
    const id = generateUuid();
    queueAgentMessage(id, t("agent.history.newChat"));
    setActiveChatId(id);
    setChatHistory((chats) => withPendingChats(chats));
    return id;
  }

  async function persistMessage(chatId: string, message: AgentMessage, token: string): Promise<void> {
    const account = getAccountId();
    queueAgentMessage(chatId, t("agent.history.newChat"), message);
    try {
      await syncAgentOutbox(token, () => account === getAccountId());
      if (account !== getAccountId()) return;
      const chats = await api.listAgentChats(token);
      if (account === getAccountId()) setChatHistory(chats);
    } catch (error) {
      if (await handleAuthError(error)) {
        setError(t("agent.error.sessionExpired"));
        return;
      }
      console.warn("Prior agent messages remain queued for sync.");
    }
  }

  function cancelStreaming(): void {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingMessageId(null);
    loadingRef.current = false;
    setLoading(false);
  }

  function handleStop(): void {
    cancelStreaming();
  }

  async function selectChat(chatId: string) {
    if (!sessionToken || chatId === activeChatId || chatLoading || dictation.isActive) return;
    // Allow switching chats while a Codex stream runs: cancel first so the
    // stale turn never clobbers the newly selected conversation.
    if (loadingRef.current) cancelStreaming();
    setChatLoading(true);
    setError(null);
    try {
      const chat = await api.getAgentChat(chatId, sessionToken);
      setActiveChatId(chat.id);
      setCodexThreadId(null);
      setMessages(withPersistedAddedFlags(chat.messages ?? []));
      setInput("");
      if (window.matchMedia("(max-width: 760px)").matches) setHistoryOpen(false);
    } catch (err: unknown) {
      const pending = pendingChats().find((chat) => chat.id === chatId);
      if (pending) {
        setActiveChatId(chatId);
        setMessages(withPersistedAddedFlags(pending.messages));
        setCodexThreadId(null);
        return;
      }
      if (await handleAuthError(err)) {
        setError(t("agent.error.sessionExpired"));
      } else {
        setError(err instanceof Error ? err.message : t("agent.error.loadChat"));
      }
    } finally {
      setChatLoading(false);
    }
  }

  function startNewChat() {
    if (chatLoading || dictation.isActive) return;
    // Allow starting a new chat while streaming: abort the turn and drop its
    // placeholder so the old response cannot leak into the fresh thread.
    if (loadingRef.current) cancelStreaming();
    setActiveChatId(null);
    setCodexThreadId(null);
    setMessages([]);
    setInput("");
    setError(null);
  }

  async function handleSend(customPrompt?: string) {
    const promptToSend = (customPrompt ?? input).trim();
    if (!promptToSend || loadingRef.current || dictation.isActive) return;

    if (settings.provider !== "codex" && !settings.apiKey) {
      // No local key: signed-in users can still use the server-side proxy
      // (POST /v1/agent/complete) with their stored key. Only block when no
      // session token is available either.
      const existingToken = sessionToken ?? (user ? await getToken().catch(() => null) : null);
      if (existingToken && !sessionToken) setSessionToken(existingToken);
      if (!existingToken) {
        setError(t("agent.error.apiKey"));
        return;
      }
    }

    setError(null);
    setInput("");
    loadingRef.current = true;
    setLoading(true);

    try {
      const token = sessionToken ?? await getToken();
      if (token && !sessionToken) setSessionToken(token);
      const chatId = token && user ? await ensureChat() : null;

      const userMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: promptToSend,
        createdAt: new Date().toISOString(),
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      if (chatId && token) await persistMessage(chatId, userMsg, token);

      if (settings.provider !== "codex") {
        const response = await askAgent(promptToSend, nextMessages, tasks, habits, settings, notesStore.list(), notesStore.listFolders(), areas, projects, codexThreadId, token);
        if (response.codexThreadId) setCodexThreadId(response.codexThreadId);
        const assistantMsg: AgentMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.reply,
          proposedAreas: response.areas,
          proposedProjects: response.projects,
          proposedTasks: response.tasks,
          proposedHabits: response.habits,
          proposedNotes: response.notes,
          proposedFolders: response.folders,
          actualModel: response.actualModel,
          createdAt: new Date().toISOString(),
        };
        setMessages([...nextMessages, assistantMsg]);
        if (chatId && token) await persistMessage(chatId, assistantMsg, token);
        return;
      }

      // Codex path: stream in the background so the UI never freezes until
      // the answer arrives. The stream carries the raw JSON contract, which
      // is not markdown — so deltas stay silent and the single placeholder
      // bubble shows a working indicator until the parsed answer swaps in.
      const assistantId = crypto.randomUUID();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamingMessageId(assistantId);
      const placeholder: AgentMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      };
      setMessages([...nextMessages, placeholder]);

      try {
        const response = await askAgentStream(
          promptToSend,
          nextMessages,
          tasks,
          habits,
          settings,
          notesStore.list(),
          notesStore.listFolders(),
          areas,
          projects,
          codexThreadId,
          { signal: controller.signal },
        );
        if (response.codexThreadId) setCodexThreadId(response.codexThreadId);
        const assistantMsg: AgentMessage = {
          id: assistantId,
          role: "assistant",
          content: response.reply,
          proposedAreas: response.areas,
          proposedProjects: response.projects,
          proposedTasks: response.tasks,
          proposedHabits: response.habits,
          proposedNotes: response.notes,
          proposedFolders: response.folders,
          actualModel: response.actualModel,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => {
          if (!prev.some((message) => message.id === assistantId)) return prev;
          return prev.map((message) => message.id === assistantId ? assistantMsg : message);
        });
        if (chatId && token) await persistMessage(chatId, assistantMsg, token);
      } catch (streamError: unknown) {
        if (streamError instanceof DOMException && streamError.name === "AbortError") {
          // User-cancelled: the placeholder only ever held raw stream bytes,
          // never a parsed answer — always drop it.
          setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        } else {
          const msg = streamError instanceof Error ? streamError.message : t("agent.error.generate");
          setError(msg);
          setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setStreamingMessageId(null);
      }
    } catch (err: unknown) {
      if (await handleAuthError(err)) {
        setError(t("agent.error.sessionExpired"));
      } else {
        const msg = err instanceof Error ? err.message : t("agent.error.generate");
        setError(msg);
      }
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
      rememberAddedProposals([task.id]);
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
      rememberAddedProposals(ids);
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
      rememberAddedProposals([habit.id]);
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
      rememberAddedProposals(ids);
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
      rememberAddedProposals([note.id]);
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
      rememberAddedProposals(ids);
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
      rememberAddedProposals([folder.id]);
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
      rememberAddedProposals(ids);
      setMessages((prev) => markFoldersAdded(prev, messageId, ids));
    } finally {
      toAdd.forEach((folder) => setAddingIds((prev) => ({ ...prev, [folder.id]: false })));
    }
  }

  function updateProposedArea(messageId: string, areaId: string, update: Partial<ProposedArea>) {
    setMessages((prev) => updateAreaProposal(prev, messageId, areaId, update));
  }

  async function handleAddSingleArea(messageId: string, area: ProposedArea) {
    setAddingIds((prev) => ({ ...prev, [area.id]: true }));
    try {
      if (onAddAreas) await onAddAreas([areaDraftOf(area)]);
      rememberAddedProposals([area.id]);
      setMessages((prev) => markAreasAdded(prev, messageId, new Set([area.id])));
    } finally {
      setAddingIds((prev) => ({ ...prev, [area.id]: false }));
    }
  }

  async function handleAddAllAreas(messageId: string, proposed: ProposedArea[]) {
    const toAdd = proposed.filter((area) => area.selected && !area.added);
    if (!toAdd.length) return;
    const ids = new Set(toAdd.map((area) => area.id));
    toAdd.forEach((area) => setAddingIds((prev) => ({ ...prev, [area.id]: true })));
    try {
      if (onAddAreas) await onAddAreas(toAdd.map(areaDraftOf));
      rememberAddedProposals(ids);
      setMessages((prev) => markAreasAdded(prev, messageId, ids));
    } finally {
      toAdd.forEach((area) => setAddingIds((prev) => ({ ...prev, [area.id]: false })));
    }
  }

  function updateProposedProject(messageId: string, projectId: string, update: Partial<ProposedProject>) {
    setMessages((prev) => updateProjectProposal(prev, messageId, projectId, update));
  }

  async function handleAddSingleProject(messageId: string, project: ProposedProject) {
    setAddingIds((prev) => ({ ...prev, [project.id]: true }));
    try {
      if (onAddProjects) await onAddProjects([projectDraftOf(project)]);
      rememberAddedProposals([project.id]);
      setMessages((prev) => markProjectsAdded(prev, messageId, new Set([project.id])));
    } finally {
      setAddingIds((prev) => ({ ...prev, [project.id]: false }));
    }
  }

  async function handleAddAllProjects(messageId: string, proposed: ProposedProject[]) {
    const toAdd = proposed.filter((project) => project.selected && !project.added);
    if (!toAdd.length) return;
    const ids = new Set(toAdd.map((project) => project.id));
    toAdd.forEach((project) => setAddingIds((prev) => ({ ...prev, [project.id]: true })));
    try {
      if (onAddProjects) await onAddProjects(toAdd.map(projectDraftOf));
      rememberAddedProposals(ids);
      setMessages((prev) => markProjectsAdded(prev, messageId, ids));
    } finally {
      toAdd.forEach((project) => setAddingIds((prev) => ({ ...prev, [project.id]: false })));
    }
  }

  const messageHandlers: AssistantMessageHandlers = {
    addingIds,
    onUpdateArea: updateProposedArea,
    onAddSingleArea: (messageId, area) => void handleAddSingleArea(messageId, area),
    onAddAllAreas: (messageId, areas) => void handleAddAllAreas(messageId, areas),
    onUpdateProject: updateProposedProject,
    onAddSingleProject: (messageId, project) => void handleAddSingleProject(messageId, project),
    onAddAllProjects: (messageId, projects) => void handleAddAllProjects(messageId, projects),
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
          <h3 id="prior-ai-assistant-title">{t("agent.header.title")}</h3>
        </div>
        <div className="agent-header-actions">
          <button
            type="button"
            className="icon-button agent-new-chat"
            title={t("agent.header.newChat")}
            aria-label={t("agent.header.newChat")}
            onClick={startNewChat}
            disabled={dictation.isActive}
          >
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-button" aria-label={t("agent.header.close")} onClick={handleClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <button className="agent-history-toggle" type="button" aria-expanded={historyOpen} aria-controls="prior-chat-history" onClick={() => setHistoryOpen((value) => !value)}>
        <span>{t("agent.history.toggle")}</span>
        <Icon name="chevron-down" />
      </button>
      <nav id="prior-chat-history" className="agent-chat-history" aria-label={t("agent.history.toggle")} hidden={!historyOpen}>
        {historyLoading && <span className="agent-history-note">{t("agent.history.loading")}</span>}
        {!historyLoading && chatHistory.map((chat) => (
          <button
            key={chat.id}
            type="button"
            className={`agent-chat-item ${chat.id === activeChatId ? "active" : ""}`}
            aria-current={chat.id === activeChatId ? "page" : undefined}
            aria-label={chat.title}
            title={chat.title}
            onClick={() => void selectChat(chat.id)}
            disabled={chatLoading || dictation.isActive}
          >
            <span>{chat.title}</span>
          </button>
        ))}
        {!historyLoading && !chatHistory.length && !user && <span className="agent-history-note">{t("agent.history.signIn")}</span>}
      </nav>

      <div className="agent-body">
        {messages.length === 0 ? (
          <div className="agent-welcome">
            <div className="agent-welcome-visual" aria-hidden="true">
              <span className="agent-welcome-halo" />
              <AgentIdentity size="hero" />
            </div>
            <h4>{t("agent.welcome.title")}</h4>

            <div className="starter-prompts-grid">
              {starterPrompts.map((item) => (
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
              msg.id === streamingMessageId
                ? (
                  <div className="agent-message-row assistant" key={msg.id}>
                    <div className="agent-message-avatar">
                      <AgentIdentity size="tiny" thinking />
                    </div>
                    <div className="agent-message-bubble loading-bubble" role="status" aria-live="polite">
                      <span className="loading-text">{t("agent.streaming.codex")}</span>
                    </div>
                  </div>
                )
                : <AssistantMessage key={msg.id} message={msg} handlers={messageHandlers} />
            ))}

            {loading && !streamingMessageId && (
              <div className="agent-message-row assistant">
                <div className="agent-message-avatar">
                  <AgentIdentity size="tiny" thinking />
                </div>
                <div className="agent-message-bubble loading-bubble" role="status" aria-live="polite">
                  <span className="loading-text">{t("agent.streaming.thinking")}</span>
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
          <button type="button" onClick={() => setError(null)} aria-label={t("agent.error.dismiss")}>
            <Icon name="close" />
          </button>
        </div>
      )}

      {settings.provider === "codex" && (
        <div className="agent-codex-provider" role="status">
          <Icon name="sparkles" />
          <span><strong>{t("agent.provider.codexTitle")}</strong><small>{t("agent.provider.codexSub")}</small></span>
        </div>
      )}
      <div className="agent-model-row">
        <label id="prior-agent-model-label">{settings.provider === "codex" ? t("agent.model.labelCodex") : t("agent.model.label")}</label>
        <div className="agent-model-picker" ref={modelPickerRef}>
          <button
            type="button"
            className="agent-model-trigger"
            aria-haspopup="listbox"
            aria-expanded={modelPickerOpen}
            aria-labelledby="prior-agent-model-label prior-agent-model-value"
            onClick={() => {
              setReasoningPickerOpen(false);
              setModelPickerOpen((open) => !open);
            }}
          >
            <span id="prior-agent-model-value" className="agent-model-trigger-copy">
              <strong>{selectedModel?.label ?? shortModelName(settings.model, t("agent.model.free"))}</strong>
            </span>
            <Icon name="chevron-down" />
          </button>
          {modelPickerOpen && (
            <div className="agent-model-popover" role="dialog" aria-label={t("agent.model.choose")}>
              <label className="agent-model-search">
                <Icon name="search" />
                <input
                  autoFocus
                  type="search"
                  autoComplete="off"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder={settings.provider === "codex" ? t("agent.model.searchCodex") : t("agent.model.searchOpenrouter")}
                  aria-label={settings.provider === "codex" ? t("agent.model.searchCodex") : t("agent.model.searchOpenrouterLabel")}
                />
                {modelQuery && <button type="button" aria-label={t("agent.model.clearSearch")} onClick={() => setModelQuery("")}><Icon name="close" /></button>}
              </label>
              <div className="agent-model-results" role="listbox" aria-label={settings.provider === "codex" ? t("agent.model.listCodex") : t("agent.model.listOpenrouter")}>
                {(settings.provider === "codex" ? codexModelsLoading : modelsLoading) && <span className="agent-model-note">{t("agent.model.loading", { provider: settings.provider === "codex" ? "Codex" : "OpenRouter" })}</span>}
                {!(settings.provider === "codex" ? codexModelsLoading : modelsLoading) && !filteredModelOptions.length && <span className="agent-model-note">{t("agent.model.noMatch")}</span>}
                {filteredModelOptions.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={model.id === activeModelId}
                    className={`agent-model-option ${model.id === activeModelId ? "active" : ""}`}
                    onClick={() => { handleModelChange(model.id); setModelPickerOpen(false); setModelQuery(""); }}
                  >
                    <span className="agent-model-name">{model.label}</span>
                    {model.id === activeModelId && <Icon name="check" className="agent-model-check" />}
                  </button>
                ))}
                {filteredModelOptions.length === 80 && <span className="agent-model-note">{t("agent.model.firstEighty")}</span>}
              </div>
            </div>
          )}
        </div>
        {showReasoning && (
          <div className="agent-reasoning-picker" ref={reasoningPickerRef}>
            <button
              type="button"
              className="agent-reasoning-trigger"
              aria-haspopup="listbox"
              aria-expanded={reasoningPickerOpen}
              aria-label={t("agent.reasoning.label")}
              onClick={() => {
                setModelPickerOpen(false);
                setReasoningPickerOpen((open) => !open);
              }}
            >
              <span className="agent-reasoning-trigger-copy">
                <small>{t("agent.reasoning.title")}</small>
                <strong>{t(`agent.reasoning.${activeReasoning}`)}</strong>
              </span>
              <Icon name="chevron-down" />
            </button>
            {reasoningPickerOpen && (
              <div className="agent-reasoning-popover" role="dialog" aria-label={t("agent.reasoning.choose")}>
                <div className="agent-reasoning-results" role="listbox">
                  {REASONING_EFFORTS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={option.id === activeReasoning}
                      className={`agent-reasoning-option ${option.id === activeReasoning ? "active" : ""}`}
                      onClick={() => {
                        handleReasoningChange(option.id);
                        setReasoningPickerOpen(false);
                      }}
                    >
                      <span>{t(`agent.reasoning.${option.id}`)}</span>
                      {option.id === activeReasoning && <Icon name="check" className="agent-model-check" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {settings.provider !== "codex" && !settings.apiKey && (
        <div className="agent-key-notice" role="note">
          <span>{t("agent.keyNotice.text")}</span>
          <button type="button" className="secondary-button" onClick={() => { dictation.stop(); onOpenSettings(); }}>
            {t("agent.keyNotice.open")}
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
            autoComplete="off"
            onChange={(e) => setInput(e.target.value)}
            readOnly={dictation.isActive}
            title={dictation.isActive ? t("agent.input.stopDictation") : undefined}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t("agent.input.placeholder")}
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
              {messages.length > 0 && (
                <button type="button" className="clear-chat-btn" title={t("agent.input.clearTitle")} onClick={startNewChat} disabled={dictation.isActive}>
                  {t("agent.input.clear")}
                </button>
              )}
            </div>
            <DictationControls
              status={dictation.status}
              onStart={startDictation}
              onStop={dictation.stop}
              disabled={!user}
              disabledTitle={t("agent.input.signInVoice")}
            />
            {loading ? (
              <button
                type="button"
                className="secondary-button agent-stop-btn"
                onClick={handleStop}
                aria-label={t("agent.input.stopLabel")}
              >
                {t("agent.input.stop")}
              </button>
            ) : null}
            <button
              type="submit"
              className="primary-button agent-send-btn"
              disabled={!input.trim() || loading || dictation.isActive}
              aria-label={t("agent.input.send")}
            >
              <Icon name="arrow" />
            </button>
          </div>
        </form>
      </footer>
      </dialog>
    </>
  );
}
