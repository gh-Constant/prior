import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { api, ApiRequestError, PlanLimitError, type IncomingProjectInvite, type MentionNotification } from "./lib/api";
import { clearPendingLink, pendingLink } from "./lib/pendingLink";
import { EffectsProvider } from "./lib/gamification/effects";
import { gameStore, useGame } from "./lib/gamification/gameStore";
import { revokeCompletion, rewardHabitCheckIn, rewardTaskCompletion } from "./lib/gamification/celebrations";
import { GameCelebrations } from "./components/game/GameCelebrations";
import { GameSidebarWidget } from "./components/game/GameSidebarWidget";
import { REPLAY_ONBOARDING_EVENT } from "./components/game/GameSettingsPanel";
import { OnboardingFlow } from "./components/game/onboarding/OnboardingFlow";
import { ChestDialog, ProgressView } from "./components/game/progress";
import { AUTH_REQUIRED_EVENT, TWO_FACTOR_CHALLENGE_EVENT, clearSession, sessionUserChanged, getToken, getUser, handleAuthError, isAndroidTauri, listenForAuth, saveUser, startGoogleLogin, startNativeGoogleLogin, CHALLENGE_PENDING, type SessionUser } from "./lib/auth";
import { useI18n } from "./lib/i18n";
import { localStore } from "./lib/localStore";
import { getAccountId } from "./lib/accountScope";
import { QUADRANTS, quadrantFor } from "./lib/priority";
import { connectRealtime, REALTIME_EVENT } from "./lib/realtime";
import { newMentionsToNotify } from "./lib/comments";
import { MentionNotifications } from "./components/collaboration/MentionNotifications";
import { isDesktop, isMac, isTauri } from "./lib/platform";
import { checkForUpdate, installAvailableUpdate, type UpdateInfo } from "./lib/updater";
import type { Area, Habit, HabitDraft, NoteDraft, NoteFolderDraft, Project, ProjectStatus, ProposedEntityUpdate, ProposedTaskUpdate, Task, TaskDraft } from "./types";
import { generateUuid } from "./lib/uuid";
import { dateKey as habitDateKey } from "./lib/habits";
import { Icon } from "./components/Icon";
import { EisenhowerMatrix } from "./components/EisenhowerMatrix";
import { TaskComposer, type TaskComposerContext } from "./components/TaskComposer";
import { CompletionExitProvider } from "./components/TaskRow";
import { TaskColumns } from "./components/TaskColumns";
import { AllTasksView } from "./components/AllTasksView";
import { AccountDialog } from "./components/AccountDialog";
import { AuthGate } from "./components/AuthGate";
import { AccountLinkPage, parseAccountLinkRoute, type AccountLinkRoute } from "./components/account/AccountLinkPage";
import { VerifyEmailBanner } from "./components/account/VerifyEmailBanner";
import { ACCOUNT_DELETED_EVENT } from "./components/account/DeleteAccountDialog";
import { wipeAccountLocalData } from "./lib/accountData";
import { defaultTaskFilters, type TaskFilterState } from "./lib/taskFilters";
import { TaskFilters } from "./components/TaskFilters";
import { AgentSidebar } from "./components/AgentSidebar";
import { HabitComposer } from "./components/HabitComposer";
import { HabitView } from "./components/HabitView";
import { CompletionBurst } from "./components/CompletionBurst";
import { filterTasksWithExitingCompletions, useCompletionExits } from "./lib/completionExit";
import { AppSidebar, type WorkspaceView } from "./components/AppSidebar";
import { AdminView } from "./components/billing/AdminView";
import { PricingView } from "./components/billing/PricingView";
import { useBilling } from "./hooks/useBilling";
import { MobileTopBar } from "./components/MobileTopBar";
import { MobileTabBar } from "./components/MobileTabBar";
import { MobileMoreScreen } from "./components/MobileMoreScreen";
import { habitProgressForDay, waitingTaskCount } from "./lib/navCounts";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { pullAssistantSettings } from "./lib/settingsSync";
import { SettingsPage, type SettingsTab } from "./components/SettingsPage";
import { CommandPalette, isPaletteShortcut, type PaletteCommand } from "./components/CommandPalette";
import { requestNoteOpen } from "./components/NotesWorkspace";
import { setThemePreference } from "./lib/theme";
import { NotesWorkspace } from "./components/NotesWorkspace";
import { notesStore } from "./lib/notes";
import { workspaceSync } from "./lib/workspaceSync";
import { ACCOUNT_DATA_LOCAL, setAccountPreference, syncAccountDocuments } from "./lib/accountDocuments";
import { initializeAccountPreferences, applyAccountPreferences, PREFERENCES_APPLIED } from "./lib/accountPreferences";
import { initializeCalendarSync } from "./lib/calendarSync";
import { loadLegacyCalendarState } from "./lib/calendar";
import { syncNoteAttachments } from "./lib/noteAttachments";
import { syncAgentOutbox } from "./lib/agentOutbox";
import { workspaceStore } from "./lib/workspaceStore";
import { collaborationStore } from "./lib/collaborationStore";
import { isOnline, useOnline } from "./lib/connectivity";
import { WorkHubView, type WorkHubViewKind } from "./components/WorkHubView";
import { MailView } from "./components/MailView";
import { CalendarView } from "./components/CalendarView";
import { CalendarConnectionSuccess } from "./components/CalendarConnectionSuccess";
import { ProjectEditor } from "./components/collaboration/ProjectEditor";
import { ProjectInviteNotifications } from "./components/collaboration/ProjectInviteNotifications";
import { ProjectCycleEditor } from "./components/collaboration/ProjectCycleEditor";
import { ProjectMilestoneEditor } from "./components/collaboration/ProjectMilestoneEditor";
import type { Person, ProjectCollaborationProps, TaskPerson, TaskPlanningProps } from "./components/collaboration/types";
import { generateTaskFromMail } from "./lib/mailTask";
import { emitMailAccountChange, saveMailAccount } from "./lib/mailAuth";
import { emitCalendarAccountChange, parseCalendarConnectedUrl, startGoogleCalendarConnect } from "./lib/calendarAuth";
import { parseWidgetUrl, refreshWidgetSnapshot } from "./lib/widgetSnapshot";
import { NOTIFICATION_OPEN_EVENT, notificationScheduler } from "./lib/notificationScheduler";
import { NOTIFICATION_SETTINGS_EVENT, parseNotificationTarget } from "./lib/reminders";
import { applyQuickAddShortcut, QUICK_TASK_CREATED_EVENT } from "./lib/quickCapture";
import { logger } from "./lib/logger";
import { resetLastSyncedAt } from "./lib/syncStatus";
import { purgeProductionDemoData } from "./lib/productionData";
import { DEFAULT_ROUTE, parseRoute, routeToPath, samePage, type AppRoute } from "./lib/router";
import { localProjectActivity, newlyAssignedToMe, tasksAssignedTo, withAssignee } from "./lib/assignment";
import type { MailMessage } from "./types";

logger.init();

type Layout = "list" | "board";

/**
 * How much a sync cycle covers. Realtime events name what changed so only
 * that part runs: "tasks" pushes/pulls tasks and habits, "shared" adds the
 * workspace, shared projects, invites and mentions, "presence" only refreshes
 * who is online, "full" is everything (startup, focus, manual).
 */
type SyncScope = "presence" | "tasks" | "shared" | "full";

function mergeSyncScopes(queued: SyncScope | null, next: SyncScope): SyncScope {
  if (!queued || queued === next) return next;
  if (queued === "full" || next === "full") return "full";
  if (queued === "shared" || next === "shared") return "shared";
  // tasks + presence: the shared scope covers both.
  return "shared";
}

function syncScopeForRealtime(type: string | undefined): SyncScope {
  if (type === "tasks_required" || type === "sync" || type === "sync_required") return "tasks";
  if (type === "presence_required") return "presence";
  if (type === "collaboration_required" || type === "invites_required" || type === "workspace_required" || type === "workspace") return "shared";
  return "full";
}

/** Where invite links point from native builds, which have no web origin. */
const WEB_APP_URL = "https://app.prior.constantsuchet.fr/";

function viewTitle(view: WorkspaceView, t: (key: string) => string): string {
  if (view === "today") return t("common.views.today");
  if (view === "inbox") return t("common.views.inbox");
  if (view === "calendar") return t("common.views.calendar");
  if (view === "projects") return t("common.views.projects");
  if (view === "project") return t("common.views.project");
  if (view === "mine") return t("common.views.myTasks");
  if (view === "waiting") return t("common.views.waiting");
  if (view === "eisenhower") return t("tasks.matrix.title");
  if (view === "habits") return t("common.views.habits");
  if (view === "notes") return t("common.views.notes");
  if (view === "settings") return t("common.views.settings");
  if (view === "plans") return t("common.views.plans");
  if (view === "admin") return t("common.views.admin");
  if (view === "progress") return t("game.nav.progress");
  return t("common.views.allTasks");
}

type WorkspaceHeaderProps = {
  readonly activeView: WorkspaceView;
  readonly layout: Layout;
  readonly onLayoutChange: (layout: Layout) => void;
  readonly shortcut: string;
  readonly shortcutKey: string;
  readonly onNewTask: () => void;
  /** Muted count next to the title (all tasks, priorities). */
  readonly subtitle?: string;
  /** Extra header controls placed before the primary action. */
  readonly extraActions?: ReactNode;
};

function WorkspaceHeader({ activeView, layout, onLayoutChange, shortcut, shortcutKey, onNewTask, subtitle, extraActions }: WorkspaceHeaderProps) {
  const { t } = useI18n();
  if (["today", "inbox", "projects", "project", "waiting", "notes", "settings", "plans", "admin", "progress"].includes(activeView)) return null;
  const creatingHabit = activeView === "habits";
  const newTaskLabel = creatingHabit ? t("common.header.newHabit") : t("common.header.newTask");
  return (
    <header className={`workspace-header ${activeView === "all" || activeView === "mine" || activeView === "eisenhower" ? "tasks-header" : ""}`}>
      {subtitle ? <div className="workspace-heading"><h1>{viewTitle(activeView, t)}</h1><span className="workspace-subtitle">{subtitle}</span></div> : <h1>{viewTitle(activeView, t)}</h1>}
      {activeView !== "calendar" && <div className="workspace-actions">
        {(activeView === "all" || activeView === "mine") && <div className="layout-switch layout-switch-labeled" role="toolbar" aria-label={t("common.header.layout")}>
          <button type="button" className={layout === "list" ? "active" : ""} aria-label={t("tasks.list.layoutList")} aria-pressed={layout === "list"} onClick={() => onLayoutChange("list")}><Icon name="list" /><span>{t("tasks.list.layoutList")}</span></button>
          <button type="button" className={layout === "board" ? "active" : ""} aria-label={t("tasks.list.layoutBoard")} aria-pressed={layout === "board"} onClick={() => onLayoutChange("board")}><Icon name="columns" /><span>{t("tasks.list.layoutBoard")}</span></button>
        </div>}
        {extraActions}
        <button className="primary-button new-task-button" type="button" aria-label={newTaskLabel} title={t("common.header.newActionTitle", { label: newTaskLabel, shortcut })} aria-keyshortcuts={shortcutKey} onClick={onNewTask}><Icon name="plus" /><span>{newTaskLabel}</span><kbd>{shortcut}</kbd></button>
      </div>}
    </header>
  );
}

type WorkspaceContentProps = {
  readonly activeView: WorkspaceView;
  readonly user: SessionUser | null;
  readonly onUserUpdated: (user: SessionUser) => void;
  readonly layout: Layout;
  readonly grouped: Record<string, Task[]>;
  readonly tasks: Task[];
  readonly visibleTasks: Task[];
  /** "My tasks": tasks assigned to the signed-in account, and the filtered view of them. */
  readonly myTasks: Task[];
  readonly myVisibleTasks: Task[];
  readonly habits: Habit[];
  readonly onHabitAdd: () => void;
  readonly onHabitComplete: (habit: Habit, date: string) => Promise<void>;
  readonly onHabitChange: (habit: Habit) => Promise<void>;
  readonly onHabitDelete: (habit: Habit) => Promise<void>;
  readonly onHabitEdit: (habit: Habit) => void;
  readonly onTaskChange: (task: Task) => Promise<void>;
  readonly onTaskDelete: (task: Task) => Promise<void>;
  readonly onTaskEdit: (task: Task) => void;
  readonly areas: Area[];
  readonly projects: Project[];
  readonly selectedProjectId: string | null;
  readonly notesProjectId: string | null;
  readonly onOpenProject: (projectId: string) => void;
  readonly onOpenNotes: (projectId?: string) => void;
  readonly onOpenWaiting: () => void;
  readonly onNewTask: (context?: TaskComposerContext) => void;
  readonly taskFilters: TaskFilterState;
  readonly onWorkspaceChange: () => void;
  readonly collaborationByProject: Readonly<Record<string, Omit<ProjectCollaborationProps, "project">>>;
  readonly onMailCreateTask: (draft: TaskDraft) => Promise<void>;
  readonly onMailCreateTaskAI: (message: MailMessage) => Promise<void>;
  readonly onQuickAddTask: (draft: TaskDraft) => Promise<void>;
  readonly onOpenAgent: () => void;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly billing: ReturnType<typeof useBilling>;
  /** Settings opens on this tab (e.g. from the Progress page). */
  readonly settingsTab?: SettingsTab;
  readonly settingsKey?: number;
  readonly onSettingsTabChange: (tab: SettingsTab) => void;
  readonly onOpenGameSettings: () => void;
  readonly projectTab: string | null;
  readonly onProjectTabChange: (tab: string) => void;
};
type CollaborationByProject = WorkspaceContentProps["collaborationByProject"];

function WorkspaceContent({ activeView, user, onUserUpdated, layout, grouped, tasks, visibleTasks, myTasks, myVisibleTasks, habits, onHabitAdd, onHabitComplete, onHabitChange, onHabitDelete, onHabitEdit, onTaskChange, onTaskDelete, onTaskEdit, areas, projects, selectedProjectId, notesProjectId, onOpenProject, onOpenNotes, onOpenWaiting, onNewTask, taskFilters, onWorkspaceChange, collaborationByProject, onMailCreateTask, onMailCreateTaskAI, onQuickAddTask, onOpenAgent, onViewChange, billing, settingsTab, settingsKey, onSettingsTabChange, onOpenGameSettings, projectTab, onProjectTabChange }: WorkspaceContentProps) {
  if (activeView === "plans") return <PricingView billing={billing.billing} signedIn={user !== null} checkoutReturn={billing.checkoutReturn} onDismissCheckoutReturn={billing.dismissCheckoutReturn} />;
  if (activeView === "admin") return billing.billing?.isAdmin ? <AdminView /> : <PricingView billing={billing.billing} signedIn={user !== null} checkoutReturn={null} onDismissCheckoutReturn={billing.dismissCheckoutReturn} />;
  if (activeView === "progress") return <ProgressView onOpenGameSettings={onOpenGameSettings} />;
  if (activeView === "settings") return <SettingsPage key={settingsKey ?? 0} user={user} onUserUpdated={onUserUpdated} tab={settingsTab ?? "general"} onTabChange={onSettingsTabChange} />;
  if (activeView === "notes") return <NotesWorkspace projectId={notesProjectId ?? undefined} />;
  if (activeView === "inbox") return <MailView user={user} onCreateTask={onMailCreateTask} onCreateTaskAI={onMailCreateTaskAI} />;
  if (activeView === "calendar") return <CalendarView habits={habits} />;
  if (["today", "projects", "project", "waiting"].includes(activeView)) return <WorkHubView view={activeView as WorkHubViewKind} tasks={tasks} areas={areas} projects={projects} selectedProjectId={selectedProjectId} onOpenProject={onOpenProject} onOpenNotes={onOpenNotes} onOpenWaiting={onOpenWaiting} onNewTask={onNewTask} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} onWorkspaceChange={onWorkspaceChange} collaborationByProject={collaborationByProject} habits={habits} onHabitComplete={onHabitComplete} onQuickAddTask={onQuickAddTask} onOpenAgent={onOpenAgent} onOpenCalendar={() => onViewChange("calendar")} onOpenHabits={() => onViewChange("habits")} projectTab={projectTab} onProjectTabChange={onProjectTabChange} currentUserId={user?.id ?? null} />;
  if (activeView === "habits") {
    return <HabitView habits={habits} onAdd={onHabitAdd} onComplete={onHabitComplete} onChange={onHabitChange} onDelete={onHabitDelete} onEdit={onHabitEdit} />;
  }
  if (activeView === "eisenhower") {
    return <EisenhowerMatrix grouped={grouped} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} onNewTask={onNewTask} />;
  }
  if (activeView === "mine") {
    if (layout === "board") return <TaskColumns tasks={myVisibleTasks} projects={projects} showDone={taskFilters.status !== "open"} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} onNewTask={onNewTask} />;
    return <AllTasksView tasks={myTasks} visibleTasks={myVisibleTasks} filters={taskFilters} projects={projects} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} onNewTask={onNewTask} />;
  }
  if (layout === "board") {
    return <TaskColumns tasks={visibleTasks} projects={projects} showDone={taskFilters.status !== "open"} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} onNewTask={onNewTask} />;
  }
  return <AllTasksView tasks={tasks} visibleTasks={visibleTasks} filters={taskFilters} projects={projects} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} onNewTask={onNewTask} />;
}

export function App() {
  const { t, tp, lang } = useI18n();
  const productionAuthRequired = import.meta.env.DEV !== true;
  const [authReady, setAuthReady] = useState(!productionAuthRequired);
  // Emailed links (/reset-password, /verify-email) open a standalone page.
  const [accountLink, setAccountLink] = useState<AccountLinkRoute | null>(() => (typeof window !== "undefined" && !isTauri() ? parseAccountLinkRoute(window.location) : null));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [areas, setAreas] = useState<Area[]>(() => workspaceStore.listAreas());
  const [projects, setProjects] = useState<Project[]>(() => workspaceStore.listProjects());
  const [, bumpCollaboration] = useReducer((value: number) => value + 1, 0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTaskContext, setNewTaskContext] = useState<TaskComposerContext | undefined>(undefined);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [mailDraft, setMailDraft] = useState<TaskDraft | null>(null);
  const [mailComposerOpen, setMailComposerOpen] = useState(false);
  const [mailAiBusy, setMailAiBusy] = useState(false);
  const [composerProjectId, setComposerProjectId] = useState<string | null | undefined>(undefined);
  const [projectEditor, setProjectEditor] = useState<Project | null>(null);
  const [cycleEditor, setCycleEditor] = useState<{ projectId: string; cycleId?: string } | null>(null);
  const [milestoneEditor, setMilestoneEditor] = useState<{ projectId: string; milestoneId?: string } | null>(null);
  const [habitComposerOpen, setHabitComposerOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState<SessionUser | null>(() => getUser());
  const billing = useBilling(user !== null);
  // The address bar is the source of the first page (reload, shared link).
  const [initialRoute] = useState<AppRoute>(() => (typeof window === "undefined" ? DEFAULT_ROUTE : parseRoute(window.location)));
  // Coming back from Stripe Checkout lands on the plans page.
  const [activeView, setActiveView] = useState<WorkspaceView>(() => (billing.checkoutReturn ? "plans" : initialRoute.view));
  const [calendarConnection, setCalendarConnection] = useState<{ email: string | null; error: string | null } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialRoute.projectId ?? null);
  const [projectTab, setProjectTab] = useState<string | null>(initialRoute.projectTab ?? null);
  const [notesProjectId, setNotesProjectId] = useState<string | null>(initialRoute.notesProjectId ?? null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("prior.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [taskFilters, setTaskFilters] = useState<TaskFilterState>(defaultTaskFilters);
  const [, bumpRelativeDateTick] = useReducer((value: number) => value + 1, 0);
  const [layout, setLayout] = useState<Layout>("list");
  const [completionCelebration, setCompletionCelebration] = useState<{ title: string; key: number } | null>(null);
  const celebrationKey = useRef(0);
  // The gamified mode (specs/GAMIFICATION.md): onboarding stays open once
  // shown until finished or put off for the session.
  const game = useGame();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingPutOff, setOnboardingPutOff] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(initialRoute.settingsTab ?? undefined);
  const [settingsKey, bumpSettingsKey] = useReducer((value: number) => value + 1, 0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chestToOpen, setChestToOpen] = useState<string | null>(null);
  const chestDialog = chestToOpen ? game.state?.chests.find((chest) => chest.id === chestToOpen) : undefined;
  const syncInFlight = useRef<Promise<void> | null>(null);
  const syncQueued = useRef<SyncScope | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncIssue, setSyncIssue] = useState(false);
  const online = useOnline();
  const [incomingInvites, setIncomingInvites] = useState<IncomingProjectInvite[]>([]);
  const [mentions, setMentions] = useState<MentionNotification[]>([]);
  const lastActiveSyncAt = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const workspaceSyncTimer = useRef<number | undefined>(undefined);
  const workspaceSyncFirstQueuedAt = useRef<number | undefined>(undefined);
  const sessionGeneration = useRef(0);
  const realtimeClose = useRef<(() => Promise<void>) | undefined>(undefined);
  const realtimeGeneration = useRef(0);
  const [desktopUpdate, setDesktopUpdate] = useState<UpdateInfo | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { deadlines: completionExitDeadlines, retain: retainCompletionExit, release: releaseCompletionExit } = useCompletionExits();
  // The assistant always starts closed: it only opens when the user asks
  // for it (sidebar button or ⌘/Ctrl J), never on arrival or after a sync.
  const [agentOpen, setAgentOpen] = useState(false);
  // Phone "More" screen, opened from the bottom tab bar.
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ N" : "Ctrl N";
  const shortcutKey = shortcut.startsWith("⌘") ? "Meta+N" : "Control+N";
  const aiShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ J" : "Ctrl J";
  const isApplePlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);

  useEffect(() => {
    if (!productionAuthRequired) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        await purgeProductionDemoData();
        let token = await getToken();
        const storedUser = getUser();
        if (!token && storedUser) {
          // Native keystore may have brief delay on Android resume/cold-start; retry once
          token = await getToken();
        }
        if (!token || !storedUser) {
          if (storedUser || token) await clearSession().catch(() => undefined);
          if (!cancelled) setUser(null);
        }
      } catch (error) {
        console.warn("Prior production data cleanup failed:", error);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [productionAuthRequired]);

  const refreshWorkspace = useCallback(() => {
    workspaceStore.syncNoteCategories();
    setAreas(workspaceStore.listAreas());
    const personalProjects = workspaceStore.listProjects();
    const personalIds = new Set(personalProjects.map((project) => project.id));
    setProjects([...personalProjects, ...collaborationStore.listProjects().filter((project) => !personalIds.has(project.id))]);
    bumpCollaboration();
  }, []);

  useEffect(() => {
    let timeout: number | undefined;
    const refreshRelativeDates = () => {
      bumpRelativeDateTick();
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 50);
      timeout = window.setTimeout(refreshRelativeDates, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    };
    const onFocus = () => bumpRelativeDateTick();
    refreshRelativeDates();
    window.addEventListener("focus", onFocus);
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("prior.sidebar.collapsed", String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    // Gmail OAuth returns to #/mail-connected?email=… after the server binds
    // the grant to this account. Record the connection and open the inbox.
    // Native shells arrive via the deep link (prior://…) instead of the hash.
    const handleMailConnected = (email: string | null) => {
      if (!email) return;
      saveMailAccount({ email, connectedAt: new Date().toISOString() });
      setToast(t("mail.toasts.connected", { email }));
      setActiveView("inbox");
      emitMailAccountChange();
    };
    const handleCalendarConnected = (result: { email: string | null; error: string | null }) => {
      setCalendarConnection(result);
      setActiveView("calendar");
      if (!result.error) emitCalendarAccountChange();
    };
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/calendar-connected")) {
        const result = parseCalendarConnectedUrl(window.location.href);
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        if (result) handleCalendarConnected(result);
        return;
      }
      // The web counterpart of prior://new-task (a browser cannot receive it).
      if (hash === "#/new-task") {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        openTargetUrl("prior://new-task");
        return;
      }
      if (!hash.startsWith("#/mail-connected")) return;
      const email = new URLSearchParams(hash.split("?")[1] ?? "").get("email");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      handleMailConnected(email);
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    let unlistenNative: (() => void) | undefined;
    void (async () => {
      if (!isTauri()) return;
      const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
      const { parseMailConnectedUrl } = await import("./lib/mailAuth");
      unlistenNative = await onOpenUrl((urls) => {
        for (const url of urls) {
          const calendarResult = parseCalendarConnectedUrl(url);
          if (calendarResult) {
            handleCalendarConnected(calendarResult);
            continue;
          }
          const email = parseMailConnectedUrl(url);
          if (email) {
            handleMailConnected(email);
            continue;
          }
          // Taps on the macOS/Android widgets land here (prior://widget/<view>).
          const widgetView = parseWidgetUrl(url);
          if (widgetView) changeView(widgetView);
          else openTargetUrl(url);
        }
      });
    })();
    return () => {
      window.removeEventListener("hashchange", handleHash);
      unlistenNative?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // prior://task/<id>, prior://habit/<id> and prior://new-task: notification
  // taps, widgets and shortcuts. A target that arrives before the tasks are
  // loaded waits in pendingTarget.
  const [pendingTarget, setPendingTarget] = useState<ReturnType<typeof parseNotificationTarget>>(() => (initialRoute.taskId ? { kind: "task", id: initialRoute.taskId } : null));
  function openTargetUrl(url: string): boolean {
    const target = parseNotificationTarget(url);
    if (!target) return false;
    setPendingTarget(target);
    return true;
  }
  useEffect(() => {
    if (!pendingTarget) return;
    if (pendingTarget.kind === "new-task") {
      setPendingTarget(null);
      setMobileMoreOpen(false);
      openNewTask();
      return;
    }
    if (pendingTarget.kind === "habit") {
      setPendingTarget(null);
      changeView("habits");
      return;
    }
    const task = tasks.find((item) => item.id === pendingTarget.id);
    if (task) {
      setPendingTarget(null);
      setComposerProjectId(task.projectId ?? null);
      setEditingTask(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget, tasks]);
  // Mirror the page in the address bar (lib/router): a reload or a shared
  // link reopens it, and Back/Forward move between pages.
  const routeTaskId = editingTask?.id || (pendingTarget?.kind === "task" ? pendingTarget.id : null);
  const routePath = routeToPath({
    view: activeView,
    projectId: activeView === "project" ? selectedProjectId : null,
    projectTab: activeView === "project" ? projectTab : null,
    notesProjectId: activeView === "notes" ? notesProjectId : null,
    settingsTab: activeView === "settings" ? settingsTab ?? null : null,
    taskId: routeTaskId,
  });
  const lastRoutePath = useRef(routeToPath(initialRoute));
  const editingTaskId = useRef<string | null>(null);
  editingTaskId.current = editingTask?.id ?? null;
  useEffect(() => {
    if (typeof window === "undefined" || accountLink) return;
    const previous = lastRoutePath.current;
    if (routePath === previous) return;
    lastRoutePath.current = routePath;
    if (`${window.location.pathname}${window.location.search}` === routePath) return;
    // Opening or closing a task stays on the same history entry.
    if (samePage(previous, routePath)) window.history.replaceState(null, "", routePath);
    else window.history.pushState(null, "", routePath);
  }, [routePath, accountLink]);
  useEffect(() => {
    const onPopState = () => {
      const route = parseRoute(window.location);
      lastRoutePath.current = routeToPath(route);
      setActiveView(route.view);
      setSelectedProjectId(route.projectId ?? null);
      setProjectTab(route.projectTab ?? null);
      setNotesProjectId(route.notesProjectId ?? null);
      setSettingsTab(route.settingsTab ?? undefined);
      setMobileMoreOpen(false);
      if (route.taskId) {
        if (route.taskId !== editingTaskId.current) setPendingTarget({ kind: "task", id: route.taskId });
      } else {
        setEditingTask(null);
        setPendingTarget((current) => (current?.kind === "task" ? null : current));
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target;
      if (target) openTargetUrl(target);
    };
    window.addEventListener(NOTIFICATION_OPEN_EVENT, onOpen);
    let cancelled = false;
    // A cold start from a widget or shortcut delivers its URL at launch.
    if (isTauri()) {
      void import("@tauri-apps/plugin-deep-link").then(({ getCurrent }) => getCurrent()).then((urls) => {
        if (cancelled) return;
        for (const url of urls ?? []) openTargetUrl(url);
      }).catch(() => undefined);
    }
    return () => { cancelled = true; window.removeEventListener(NOTIFICATION_OPEN_EVENT, onOpen); };
  }, []);

  // Desktop quick capture: register the global shortcut, and pick up tasks
  // saved from the quick-add window (same local store) right away.
  useEffect(() => {
    if (!isDesktop()) return undefined;
    void applyQuickAddShortcut().catch((error) => console.warn("Prior could not register the quick-add shortcut:", error));
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const onCreated = () => { void refresh().then(() => syncNow()).catch(() => undefined); };
    void import("@tauri-apps/api/event").then(({ listen }) => listen(QUICK_TASK_CREATED_EVENT, onCreated)).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // @mentions in task comments: in-app list plus one local notification per
  // new mention (specs/COMMENTS.md).
  async function loadMentions(token: string, generation = sessionGeneration.current): Promise<void> {
    try {
      const result = await api.listMentions(token);
      if (generation !== sessionGeneration.current) return;
      setMentions(result.mentions);
      for (const mention of newMentionsToNotify(result.mentions)) {
        void notificationScheduler.notifyNow({
          key: `mention:${mention.commentId}`,
          title: t("comments.mentions.notificationTitle", { name: mention.authorName || t("comments.deletedUser") }),
          body: `${mention.taskTitle} · ${mention.excerpt}`,
          target: `prior://task/${encodeURIComponent(mention.taskId)}`,
        });
      }
    } catch (mentionsError) {
      logger.warn("sync", "Mentions could not be loaded", { error: String(mentionsError) });
    }
  }
  useEffect(() => {
    const onRealtime = (event: Event) => {
      if ((event as CustomEvent<{ type?: string }>).detail?.type !== "mentions_required") return;
      void getToken().then((token) => (token ? loadMentions(token) : undefined));
    };
    window.addEventListener(REALTIME_EVENT, onRealtime);
    return () => window.removeEventListener(REALTIME_EVENT, onRealtime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function readMentions(commentIds: string[]): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setMentions((current) => current.map((mention) => (!commentIds.length || commentIds.includes(mention.commentId) ? { ...mention, readAt: new Date().toISOString() } : mention)));
    await api.readMentions(commentIds, token).catch(() => undefined);
  }

  // Reminders follow every local change and sync (both land in tasks/habits).
  useEffect(() => {
    void notificationScheduler.sync(tasks, habits);
  }, [tasks, habits]);
  useEffect(() => {
    const resync = () => { void notificationScheduler.sync(tasks, habits); };
    window.addEventListener(NOTIFICATION_SETTINGS_EVENT, resync);
    // Timers drift while a laptop sleeps: reschedule when the app returns.
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener(NOTIFICATION_SETTINGS_EVENT, resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [tasks, habits]);

  useEffect(() => {
    if (!completionCelebration) return undefined;

    const key = completionCelebration.key;
    const timeout = window.setTimeout(() => {
      setCompletionCelebration((current) => current?.key === key ? null : current);
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [completionCelebration]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const run = (async () => {
      const [nextTasks, nextHabits] = await Promise.all([localStore.listTasks(), localStore.listHabits()]);
      const accessibleProjects = [...workspaceStore.listProjects(), ...collaborationStore.listProjects()];
      const accessibleProjectIds = new Set(accessibleProjects.map((project) => project.id));
      // Only filter by projectId if we have accessible projects loaded;
      // if accessibleProjectIds is empty, we must not hide all tasks!
      setTasks(
        accessibleProjectIds.size === 0
          ? nextTasks
          : nextTasks.filter((task) => !task.projectId || accessibleProjectIds.has(task.projectId))
      );
      setHabits(nextHabits);
      void refreshWidgetSnapshot(nextTasks, nextHabits).catch(() => undefined);
    })();
    refreshInFlight.current = run;
    try {
      await run;
    } finally {
      if (refreshInFlight.current === run) refreshInFlight.current = null;
    }
  }, []);

  const syncNow = useCallback((requested?: SyncScope | Event): Promise<void> => {
    // Also used directly as an event listener ("online"): an Event means full.
    const scope: SyncScope = typeof requested === "string" ? requested : "full";
    if (syncInFlight.current) {
      syncQueued.current = mergeSyncScopes(syncQueued.current, scope);
      return syncInFlight.current;
    }
    // Every sync (manual or automatic) flows through here, so the sidebar
    // spinner reflects the real sync activity. Realtime events run a narrower
    // scope (a collaborator's task, a membership change) so they land fast.
    const full = scope === "full";
    const shared = full || scope === "shared";
    const syncTasks = scope !== "presence";
    if (full) setSyncing(true);

    const run = (async () => {
      try {
        const generation = sessionGeneration.current;
        const token = await getToken();
        if (!token || generation !== sessionGeneration.current) return;
        const syncAccountId = getAccountId();

        logger.info("sync", "Starting sync cycle", { scope });
        const incomplete: string[] = [];
        const syncStartedAt = Date.now();

        if (scope === "presence") {
          // Someone opened or closed Prior: only the member list changes.
          try {
            await collaborationStore.sync(token);
          } catch (presenceError) {
            logger.warn("sync", "Collaboration presence refresh failed", { error: String(presenceError) });
          }
          return;
        }

        // Profile first: the server copy wins so a rename on another device
        // converges locally. Failures are non-fatal for task data.
        if (full) try {
          const profile = await api.getProfile(token);
          if (generation !== sessionGeneration.current) return;
          const currentUser = getUser();
          if (!currentUser || sessionUserChanged(currentUser, profile)) {
            saveUser(profile);
            setUser(profile);
          }
        } catch (profileError) {
          if (await handleAuthError(profileError)) {
            if (generation !== sessionGeneration.current) return;
            setUser(null);
            setAuthError(profileError instanceof Error ? profileError.message : t("common.session.expired"));
            setAuthOpen(true);
            setToast(t("common.toasts.sessionExpired"));
            return;
          }
          logger.warn("sync", "Profile sync failed", { error: String(profileError) });
          incomplete.push("profile");
          console.warn("Prior profile sync failed:", profileError);
        }

        // Calendar and preference sync must run even when a task mutation or
        // task pull fails. These domains have independent server storage.
        if (full) try {
          initializeCalendarSync(loadLegacyCalendarState());
          initializeAccountPreferences();
          await syncAccountDocuments(token, () => generation === sessionGeneration.current);
          if (generation === sessionGeneration.current) applyAccountPreferences();
        } catch (accountDataError) {
          incomplete.push("calendars/preferences");
          logger.error("sync", "Calendar/account data sync failed; local changes remain queued", { error: String(accountDataError) });
          console.warn("Prior account data sync failed; will retry.");
        }
        if (generation !== sessionGeneration.current) return;

        let taskSyncComplete = false;
        let finalRevision = 0;
        let pushedCount = 0;
        let pendingSnapshot = { tasks: new Set<string>(), habits: new Set<string>() };
        let pullAll: ((since: number) => Promise<Awaited<ReturnType<typeof api.pull>>>) | null = null;
        if (syncTasks) try {
          // navigator.onLine is unreliable in Tauri webviews. The API request has
          // its own timeout and is the source of truth for connectivity.
          const state = await localStore.getSyncState();
          let highestPushedRevision = state.lastServerRevision;
          const pending = await localStore.pendingMutations();
          // Server push batches are capped at 100 mutations; chunk client-side.
          for (let offset = 0; offset < pending.length; offset += 100) {
            if (generation !== sessionGeneration.current || syncAccountId !== getAccountId()) return;
            const chunk = pending.slice(offset, offset + 100);
            const pushed = await api.push(chunk, token);
            if (generation !== sessionGeneration.current) return;
            pushedCount += pushed.applied.length;
            await localStore.removeMutations(pushed.applied.map((item) => item.mutationId), syncAccountId);
            highestPushedRevision = pushed.applied.reduce((value, item) => Math.max(value, item.revision), highestPushedRevision);
          }

          // Paged pull: server caps a single response at PullPageSize (200
          // revisions). Follow nextSince/hasMore so large histories converge.
          pullAll = async function (since: number) {
            const first = await api.pull(since, token as string);
            if (generation !== sessionGeneration.current) return first;
            let combined = first;
            let previousCursor = since;
            while (combined.hasMore && typeof combined.nextSince === "number") {
              const cursor: number = combined.nextSince;
              if (cursor <= previousCursor) throw new Error("Sync pagination did not advance");
              previousCursor = cursor;
              const next = await api.pull(cursor, token as string);
              if (generation !== sessionGeneration.current) return combined;
              combined = {
                ...next,
                tasks: [...combined.tasks, ...next.tasks],
                habits: [...(combined.habits ?? []), ...(next.habits ?? [])],
              };
            }
            if (combined.hasMore) throw new Error("Sync history was incomplete; retaining the previous cursor for retry.");
            return combined;
          };

          let pulled = await pullAll(state.lastServerRevision);
          if (generation !== sessionGeneration.current) return;

          const accountId = syncAccountId;
          if (accountId && localStore.needsLegacySync(accountId)) {
            logger.info("sync", "Running legacy migration for account", { accountId });
            const fullHistory = state.lastServerRevision === 0 ? pulled : await pullAll(0);
            if (generation !== sessionGeneration.current) return;
            const legacy = await localStore.legacyMutations(
              accountId,
              new Set(fullHistory.tasks.map((task) => task.id)),
              new Set((fullHistory.habits ?? []).map((habit) => habit.id)),
            );
            for (let offset = 0; offset < legacy.length; offset += 100) {
              if (generation !== sessionGeneration.current || syncAccountId !== getAccountId()) return;
              const pushedLegacy = await api.push(legacy.slice(offset, offset + 100), token);
              if (generation !== sessionGeneration.current) return;
              await localStore.removeMutations(pushedLegacy.applied.map((item) => item.mutationId), syncAccountId);
              highestPushedRevision = pushedLegacy.applied.reduce((value, item) => Math.max(value, item.revision), highestPushedRevision);
            }
            localStore.markLegacySyncComplete(accountId);
            logger.info("sync", "Legacy migration completed", { mutationsCount: legacy.length });
            if (legacy.length) {
              pulled = await pullAll(state.lastServerRevision);
              if (generation !== sessionGeneration.current) return;
            }
          }

          // Snapshot pending ids once per sync so remote merges skip exactly the
          // edits that were still queued when this sync started.
          pendingSnapshot = await localStore.pendingIdsSnapshot();
          // Tell the user when a collaborator assigns them a task (not on a
          // first sync, where every assignment is old news).
          const assignedBefore = state.lastServerRevision > 0 && pulled.tasks.length ? new Map((await localStore.listTasks()).map((task) => [task.id, task])) : null;
          await localStore.applyRemoteTasks(pulled.tasks, pendingSnapshot.tasks, syncAccountId);
          if (assignedBefore) {
            for (const task of newlyAssignedToMe(assignedBefore, pulled.tasks.filter((item) => !pendingSnapshot.tasks.has(item.id)), getUser()?.id)) {
              void notificationScheduler.notifyNow({ key: `assigned:${task.id}:${task.updatedAt}`, title: t("collab.assign.notificationTitle"), body: task.title, target: `prior://task/${encodeURIComponent(task.id)}` });
            }
          }
          await localStore.applyRemoteHabits(pulled.habits ?? [], pendingSnapshot.habits, syncAccountId);
          if (generation !== sessionGeneration.current || syncAccountId !== getAccountId()) return;

          // Update task/habit revision and refresh UI immediately
          finalRevision = Math.max(pulled.revision, highestPushedRevision);
          await localStore.setSyncRevision(finalRevision, syncAccountId);
          await refresh();
          taskSyncComplete = true;
        } catch (taskError) {
          if (await handleAuthError(taskError)) {
            if (generation !== sessionGeneration.current) return;
            setUser(null);
            setAuthError(taskError instanceof Error ? taskError.message : t("common.session.expired"));
            setAuthOpen(true);
            setToast(t("common.toasts.sessionExpired"));
            return;
          }
          incomplete.push("tasks/habits");
          logger.error("sync", "Task and habit sync failed; queued edits will retry", { error: String(taskError) });
          console.warn("Prior task and habit sync failed:", taskError);
        }

        if (generation !== sessionGeneration.current) return;

        if (full) try {
          await syncNoteAttachments(token, () => generation === sessionGeneration.current);
        } catch (attachmentError) {
          incomplete.push("attachments");
          logger.warn("sync", "Note attachments remain pending", { error: String(attachmentError) });
        }
        if (generation !== sessionGeneration.current) return;

        if (shared) try {
          await workspaceSync.sync(token, () => generation === sessionGeneration.current);
          if (generation === sessionGeneration.current) {
            refreshWorkspace();
            await refresh();
          }
        } catch (workspaceError) {
          incomplete.push("workspace");
          logger.error("sync", "Workspace sync failed", { error: String(workspaceError) });
          console.warn("Prior workspace sync failed:", workspaceError);
        }

        if (generation !== sessionGeneration.current) return;

        // Collaboration sync in an isolated try/catch
        let collaborationChanged = false;
        if (shared) try {
          collaborationChanged = (await collaborationStore.sync(token)).changed;
        } catch (collaborationError) {
          incomplete.push("collaboration");
          logger.warn("sync", "Collaboration sync failed", { error: String(collaborationError) });
          console.warn("Prior collaboration sync failed:", collaborationError);
        }

        // A shared link opened before signing in (see lib/pendingLink).
        const link = shared ? pendingLink() : null;
        if (link?.invite) {
          try {
            const { projectId } = await api.acceptProjectInvite(link.invite, token);
            clearPendingLink();
            collaborationChanged = (await collaborationStore.sync(token)).changed || collaborationChanged;
            if (generation === sessionGeneration.current) openProject(projectId);
            setToast(t("common.toasts.inviteAccepted"));
          } catch (inviteError) {
            // Offline: try again on the next sync. Anything else (expired,
            // already used, wrong account) will never succeed.
            if (!(inviteError instanceof ApiRequestError && (inviteError.kind === "network" || inviteError.kind === "timeout"))) clearPendingLink();
            logger.warn("sync", "Project invite could not be accepted", { error: String(inviteError) });
            console.warn("Prior project invite could not be accepted:", inviteError);
          }
        } else if (link?.project) {
          clearPendingLink();
          const known = [...workspaceStore.listProjects(), ...collaborationStore.listProjects()].some((project) => project.id === link.project);
          if (generation === sessionGeneration.current) {
            if (known) openProject(link.project);
            else setToast(t("common.toasts.projectLinkUnavailable"));
          }
        }

        if (shared) {
          try {
            const { invites } = await api.listIncomingInvites(token);
            if (generation === sessionGeneration.current) setIncomingInvites(invites);
          } catch (invitesError) {
            logger.warn("sync", "Project invites could not be loaded", { error: String(invitesError) });
          }
          await loadMentions(token, generation);
        }

        // A newly accepted/shared project may contain task revisions older than
        // this account's normal sync cursor. Pull the authorized history once
        // when the project ACL changes so the member sees the existing work.
        if (collaborationChanged && taskSyncComplete && pullAll) {
          try {
            const collaborationHistory = await pullAll(0);
            if (generation !== sessionGeneration.current || syncAccountId !== getAccountId()) return;
            await localStore.applyRemoteTasks(collaborationHistory.tasks, pendingSnapshot.tasks, syncAccountId);
            const updatedRevision = Math.max(finalRevision, collaborationHistory.revision);
            await localStore.setSyncRevision(updatedRevision, syncAccountId);
            await refresh();
          } catch (historyError) {
            incomplete.push("collaboration history");
            logger.warn("sync", "Shared project history remains pending", { error: String(historyError) });
          }
        }

        // Assistant settings follow the account after workspace data.
        if (full) try {
          await syncAgentOutbox(token, () => generation === sessionGeneration.current);
        } catch (chatError) {
          incomplete.push("chats");
          logger.warn("sync", "Agent messages remain queued", { error: String(chatError) });
        }
        if (generation !== sessionGeneration.current) return;
        if (full) try {
          const settingsOk = await pullAssistantSettings();
          if (!settingsOk) { incomplete.push("settings"); logger.warn("sync", "Assistant settings not yet synced; will retry on next sync"); }
        } catch (settingsError) {
          if (await handleAuthError(settingsError)) {
            if (generation !== sessionGeneration.current) return;
            setUser(null);
            setAuthError(settingsError instanceof Error ? settingsError.message : t("common.session.expired"));
            setAuthOpen(true);
            setToast(t("common.toasts.sessionExpired"));
            return;
          }
          logger.warn("sync", "Assistant settings sync failed", { error: String(settingsError) });
          incomplete.push("settings");
          console.warn("Prior assistant settings sync failed:", settingsError);
        }

        if (generation !== sessionGeneration.current || syncAccountId !== getAccountId()) return;
        // XP is earned by the push above; fetch the result (and any level-up)
        // unless the push failed, so optimistic XP isn't dropped while offline.
        if (!incomplete.includes("tasks/habits") && (full || pushedCount > 0)) void gameStore.refresh(syncStartedAt);
        // A narrower sync cannot vouch for the sections it skipped.
        if (full || incomplete.length > 0) setSyncIssue(incomplete.length > 0);
        if (incomplete.length) logger.warn("sync", "Sync partially completed; pending sections will retry", { sections: incomplete });
        else {
          window.dispatchEvent(new Event("prior-sync-complete"));
          logger.info("sync", "Sync cycle completed successfully", { revision: finalRevision });
        }
      } catch (error) {
        setSyncIssue(true);
        logger.error("sync", "Prior sync failed", { error: String(error) });
        if (await handleAuthError(error)) {
          setUser(null);
          setAuthError(error instanceof Error ? error.message : t("common.session.expired"));
          setAuthOpen(true);
          setToast(t("common.toasts.sessionExpired"));
          return;
        }
        console.warn("Prior sync failed:", error);
      }
    })();
    syncInFlight.current = run;
    void run.finally(() => {
      if (syncInFlight.current === run) syncInFlight.current = null;
      const queued = syncQueued.current;
      if (queued) {
        syncQueued.current = null;
        if (queued !== "full") setSyncing(false);
        void syncNow(queued);
      } else {
        setSyncing(false);
      }
    }).catch(() => undefined);
    return run;
  }, [refresh]);

  const syncOnActive = useCallback(() => {
    const nowMs = Date.now();
    if (nowMs - lastActiveSyncAt.current < 15_000) return;
    lastActiveSyncAt.current = nowMs;
    void syncNow();
  }, [syncNow]);

  const scheduleWorkspaceSync = useCallback(() => {
    if (workspaceSync.isApplyingRemote()) return;
    const nowMs = Date.now();
    if (workspaceSyncTimer.current !== undefined) window.clearTimeout(workspaceSyncTimer.current);
    if (workspaceSyncFirstQueuedAt.current === undefined) workspaceSyncFirstQueuedAt.current = nowMs;
    const elapsed = nowMs - (workspaceSyncFirstQueuedAt.current ?? nowMs);
    // Single scheduler: debounce 500ms with a 5s maxWait so rapid edits batch
    // but a sustained burst cannot starve the sync indefinitely.
    if (elapsed >= 5000) {
      workspaceSyncFirstQueuedAt.current = undefined;
      workspaceSyncTimer.current = undefined;
      void syncNow();
      return;
    }
    workspaceSyncTimer.current = window.setTimeout(() => {
      workspaceSyncTimer.current = undefined;
      workspaceSyncFirstQueuedAt.current = undefined;
      void syncNow();
    }, 500);
  }, [syncNow]);

  const attachRealtime = useCallback(async () => {
    const generation = ++realtimeGeneration.current;
    const token = await getToken().catch((error) => {
      console.warn("Prior realtime could not read the session token:", error);
      return null;
    });
    if (!token || generation !== realtimeGeneration.current) return;
    try {
      await realtimeClose.current?.();
    } catch (error) {
      console.warn("Prior realtime cleanup failed:", error);
    }
    if (generation !== realtimeGeneration.current) return;
    try {
      realtimeClose.current = await connectRealtime(
        token,
        (_revision, type) => void syncNow(syncScopeForRealtime(type)),
        { getRevision: async () => (await localStore.getSyncState()).lastServerRevision },
      );
    } catch (error) {
      console.warn("Prior realtime attach failed; retrying on next trigger:", error);
      if (generation === realtimeGeneration.current) {
        window.setTimeout(() => {
          if (generation === realtimeGeneration.current) void attachRealtime().catch((retryError) => console.warn("Prior realtime retry failed:", retryError));
        }, 5000);
      }
    }
  }, [syncNow]);

  useEffect(() => {
    void refresh().catch((error) => console.warn("Prior local store failed:", error));
    refreshWorkspace();
    void syncNow();
    void attachRealtime().catch((error) => console.warn("Prior realtime attach failed:", error));
    const dispose = listenForAuth((nextUser) => {
      sessionGeneration.current += 1;
      resetLastSyncedAt();
      setSyncIssue(false);
      setUser(nextUser);
      setAuthError("");
      setAuthOpen(false);
      refreshWorkspace();
      void refresh().catch((error) => console.warn("Prior could not refresh after sign-in:", error));
      void attachRealtime().catch((error) => console.warn("Prior realtime attach failed:", error));
      void syncNow();
      void pullAssistantSettings().catch((error) => console.warn("Prior assistant settings pull failed:", error));
    }, (error) => {
      setAuthError(error.message);
      setAuthOpen(true);
    });
    return () => {
      dispose();
      realtimeGeneration.current += 1;
      const close = realtimeClose.current;
      realtimeClose.current = undefined;
      void close?.().catch((error) => console.warn("Prior realtime cleanup failed:", error));
    };
  }, [attachRealtime, refresh, refreshWorkspace, syncNow]);

  useEffect(() => {
    // Local dev seed (Workstream 6): DEV-only, anonymous account, empty
    // stores only. Never runs in prod and never overwrites real user data.
    // Dynamic import keeps the seed out of the production bundle.
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    void (async () => {
      try {
        const { seedDevDataIfEmpty } = await import("./lib/devSeed");
        const result = await seedDevDataIfEmpty();
        if (!cancelled && result.seeded) {
          refreshWorkspace();
          await refresh();
        }
      } catch (error) {
        console.warn("Prior dev seed failed:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh, refreshWorkspace]);

  useEffect(() => workspaceStore.subscribe(() => {
    refreshWorkspace();
    scheduleWorkspaceSync();
  }), [refreshWorkspace, scheduleWorkspaceSync]);

  useEffect(() => collaborationStore.subscribe(refreshWorkspace), [refreshWorkspace]);

  useEffect(() => notesStore.subscribe(scheduleWorkspaceSync), [scheduleWorkspaceSync]);
  useEffect(() => {
    window.addEventListener(ACCOUNT_DATA_LOCAL, scheduleWorkspaceSync);
    return () => window.removeEventListener(ACCOUNT_DATA_LOCAL, scheduleWorkspaceSync);
  }, [scheduleWorkspaceSync]);
  const savedUiState = useRef({ sidebarCollapsed });
  useEffect(() => {
    const patch: Record<string, string> = {};
    if (savedUiState.current.sidebarCollapsed !== sidebarCollapsed) patch["prior.sidebar.collapsed"] = String(sidebarCollapsed);
    savedUiState.current = { sidebarCollapsed };
    if (Object.keys(patch).length) setAccountPreference("ui", patch);
  }, [sidebarCollapsed]);
  useEffect(() => {
    const apply = () => { setSidebarCollapsed(localStorage.getItem("prior.sidebar.collapsed") === "true"); };
    window.addEventListener(PREFERENCES_APPLIED, apply);
    return () => window.removeEventListener(PREFERENCES_APPLIED, apply);
  }, []);

  useEffect(() => {
    const onAuthChange = () => {
      refreshWorkspace();
      void refresh().catch((error) => console.warn("Prior could not refresh on auth change:", error));
    };
    const onAuthRequired = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message ?? t("common.session.expired");
      setAuthError(message);
      setAuthOpen(true);
      setToast(message);
    };
    window.addEventListener("prior-auth-change", onAuthChange);
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => {
      window.removeEventListener("prior-auth-change", onAuthChange);
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    };
  }, [refresh, refreshWorkspace]);

  // Desktop updater: idle check 5s after startup, then daily. The manual
  // button in Settings stays authoritative; this only drives the badge dot.
  useEffect(() => {
    if (!isDesktop()) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        const update = await checkForUpdate();
        if (!cancelled && update) setDesktopUpdate(update);
      } catch (error) {
        console.warn("Prior update check failed:", error);
      }
    };
    const idleTimer = window.setTimeout(() => void check(), 5000);
    const dailyTimer = window.setInterval(() => void check(), 24 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(idleTimer);
      window.clearInterval(dailyTimer);
    };
  }, []);

  // Periodic sync every 60s while visible, plus a throttled sync when the
  // tab becomes visible again or regains focus.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncOnActive();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncNow, syncOnActive]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    if (workspaceSyncTimer.current !== undefined) window.clearTimeout(workspaceSyncTimer.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event, isApplePlatform)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (activeView === "notes") window.dispatchEvent(new Event("prior-notes-new"));
        else if (activeView === "habits") setHabitComposerOpen(true); else openNewTask();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setAgentOpen((prev) => !prev);
      }
      if (event.key === "Escape") {
        setComposerOpen(false);
        setEditingTask(null);
        setHabitComposerOpen(false);
        setAuthOpen(false);
        setAgentOpen(false);
        setMobileMoreOpen(false);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("online", syncNow);
    window.addEventListener("focus", syncOnActive);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("online", syncNow); window.removeEventListener("focus", syncOnActive); };
  }, [activeView, syncNow, syncOnActive]);

  function openNewTask(context?: TaskComposerContext): void {
    setNewTaskContext(context);
    setComposerProjectId(context?.projectId ?? null);
    setComposerOpen(true);
  }

  async function saveTask(input: TaskDraft, options?: { keepOpen?: boolean }) {
    assertProjectWritable(input.projectId);
    await localStore.saveTask({ ...newTaskContext, ...input, completed: input.status === "done", peopleIds: input.peopleIds ?? (user ? [user.id] : []) });
    if (!options?.keepOpen) {
      setComposerOpen(false);
      setNewTaskContext(undefined);
    }
    await refresh();
    void syncNow("tasks");
  }

  /** A sub-task of a task, in the same project and area. */
  async function createSubtask(parent: Task, title: string): Promise<void> {
    assertProjectWritable(parent.projectId);
    const project = projects.find((item) => item.id === parent.projectId);
    await localStore.saveTask({
      title, important: false, urgent: false, completed: false,
      projectId: parent.projectId ?? null, areaId: parent.areaId ?? null, parentId: parent.id, milestoneId: parent.milestoneId ?? null,
      status: project?.projectType === "software" ? "backlog" : "next",
      peopleIds: user ? [user.id] : [],
    });
    await refresh();
    void syncNow("tasks");
  }

  async function saveEditedTask(input: TaskDraft) {
    if (!editingTask) return;
    assertProjectWritable(editingTask.projectId);
    await localStore.updateTask({ ...editingTask, ...input, completed: input.status ? input.status === "done" : editingTask.completed, description: input.description ?? "", dueDate: input.dueDate ?? null, priority: input.priority ?? 4 });
    setEditingTask(null);
    await refresh();
    void syncNow("tasks");
  }

  /* Mail → task. Direct opens the composer pre-filled; AI drafts the fields
     from the email body first, then opens the composer for review. */
  function openMailTask(draft: TaskDraft): void {
    setMailDraft(draft);
    setMailComposerOpen(true);
  }

  async function createMailTaskAI(message: MailMessage): Promise<void> {
    if (mailAiBusy) return;
    setMailAiBusy(true);
    try {
      const token = await getToken();
      const draft = await generateTaskFromMail(message, token);
      setMailDraft(draft);
      setMailComposerOpen(true);
    } catch (error) {
      console.warn("Prior could not draft a task from mail:", error);
      setToast(t("mail.ai.failed"));
      setMailDraft({
        title: message.subject === "(no subject)" ? t("mail.title") : message.subject,
        description: [message.snippet, "", `${message.from.name} <${message.from.email}>`].join("\n").trim(),
        important: false, urgent: false, status: "inbox", priority: 4,
      });
      setMailComposerOpen(true);
    } finally {
      setMailAiBusy(false);
    }
  }

  async function saveMailTask(input: TaskDraft): Promise<void> {
    assertProjectWritable(input.projectId);
    await localStore.saveTask({ ...input, completed: input.status === "done", peopleIds: input.peopleIds ?? (user ? [user.id] : []) });
    setMailComposerOpen(false);
    setMailDraft(null);
    setToast(t("mail.toasts.taskCreated"));
    await refresh();
    void syncNow("tasks");
  }

  function resolveAgentAreaId(areaName: string | null | undefined): string | null {
    if (!areaName) return null;
    const wanted = areaName.trim().toLowerCase();
    if (!wanted) return null;
    const existing = workspaceStore.listAreas().find((a) => a.name.trim().toLowerCase() === wanted);
    if (existing) return existing.id;
    const created = workspaceStore.createArea(areaName.trim());
    setAreas(workspaceStore.listAreas());
    return created.id;
  }

  function resolveAgentProjectId(projectName: string | null | undefined, areaId: string | null = null): string | null {
    if (!projectName) return null;
    const wanted = projectName.trim().toLowerCase();
    if (!wanted) return null;
    const existing = workspaceStore.listProjects().find((p) => p.name.trim().toLowerCase() === wanted);
    if (existing) {
      if (areaId && !existing.areaId) {
        workspaceStore.updateProject({ ...existing, areaId });
        refreshWorkspace();
      }
      return existing.id;
    }
    const created = workspaceStore.createProject(projectName.trim(), areaId);
    refreshWorkspace();
    return created.id;
  }

  async function addAgentAreas(batch: Array<{ name: string; color?: string; icon?: string | null }>) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const existing = workspaceStore.listAreas().find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
      if (!existing) {
        workspaceStore.createArea(name, item.color, item.icon);
      }
    }
    setAreas(workspaceStore.listAreas());
  }

  async function addAgentProjects(batch: Array<{ name: string; areaName?: string | null; description?: string; status?: ProjectStatus; targetDate?: string | null; icon?: string | null; projectType?: Project["projectType"] }>) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const areaId = item.areaName ? resolveAgentAreaId(item.areaName) : null;
      const existing = workspaceStore.listProjects().find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      if (!existing) {
        const created = workspaceStore.createProject(name, areaId, item.description ?? "", item.icon, item.projectType);
        const updates: Partial<Project> = {};
        if (item.status && item.status !== "active") updates.status = item.status;
        if (item.targetDate) updates.targetDate = item.targetDate;
        if (Object.keys(updates).length > 0) {
          workspaceStore.updateProject({ ...created, ...updates });
        }
      } else {
        const updates: Partial<Project> = {};
        if (areaId && !existing.areaId) updates.areaId = areaId;
        if (item.targetDate && !existing.targetDate) updates.targetDate = item.targetDate;
        if (item.icon && !existing.icon) updates.icon = item.icon;
        if (Object.keys(updates).length > 0) {
          workspaceStore.updateProject({ ...existing, ...updates });
        }
      }
    }
    setAreas(workspaceStore.listAreas());
    refreshWorkspace();
  }

  async function addAgentTasks(batch: Array<TaskDraft & { areaName?: string | null; projectName?: string | null; parentTitle?: string | null }>) {
    // Parents first, so sub-tasks of the same batch can point at them.
    const ordered = [...batch].sort((left, right) => Number(Boolean(left.parentTitle)) - Number(Boolean(right.parentTitle)));
    const createdByTitle = new Map<string, Task>();
    const existing = await localStore.listTasks();
    for (const item of ordered) {
      let areaId = item.areaId ?? null;
      if (!areaId && item.areaName) {
        areaId = resolveAgentAreaId(item.areaName);
      }
      let projectId = item.projectId ?? null;
      if (!projectId && item.projectName) {
        projectId = resolveAgentProjectId(item.projectName, areaId);
      }
      const { parentTitle, areaName: _areaName, projectName: _projectName, ...draft } = item;
      let parentId = draft.parentId ?? null;
      if (!parentId && parentTitle) {
        const wanted = parentTitle.trim().toLowerCase();
        const parent = createdByTitle.get(wanted) ?? existing.find((task) => !task.deletedAt && task.title.trim().toLowerCase() === wanted && (task.projectId ?? null) === projectId);
        if (parent && (parent.projectId ?? null) === projectId) parentId = parent.id;
      }
      const people = draft.peopleIds ?? (user ? [user.id] : []);
      const saved = await localStore.saveTask({
        ...draft,
        areaId,
        projectId,
        parentId,
        peopleIds: draft.assigneeId && !people.includes(draft.assigneeId) ? [...people, draft.assigneeId] : people,
      });
      createdByTitle.set(saved.title.trim().toLowerCase(), saved);
    }
    await refresh();
    void syncNow("tasks");
  }

  /* Applies confirmed changes to existing projects, habits, notes and areas
     (the assistant's update_project/habit/note/area cards). */
  async function applyAgentEntityUpdates(batch: ProposedEntityUpdate[]) {
    for (const item of batch) {
      const { changes } = item;
      if (item.kind === "project") {
        const project = projects.find((candidate) => candidate.id === item.targetId);
        if (!project) continue;
        const milestones = [...(project.milestones ?? []), ...(changes.addMilestones ?? []).map((milestone) => ({ id: generateUuid(), name: milestone.name, targetDate: milestone.targetDate }))];
        await saveProjectDetails({
          ...project,
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.description !== undefined ? { description: changes.description } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          ...(changes.health !== undefined ? { health: changes.health } : {}),
          ...(changes.startDate !== undefined ? { startDate: changes.startDate } : {}),
          ...(changes.targetDate !== undefined ? { targetDate: changes.targetDate } : {}),
          ...(changes.projectType !== undefined ? { projectType: changes.projectType } : {}),
          ...(changes.icon ? { icon: changes.icon } : {}),
          ...(changes.addMilestones?.length ? { milestones } : {}),
          updatedAt: new Date().toISOString(),
        });
      } else if (item.kind === "habit") {
        const habit = habits.find((candidate) => candidate.id === item.targetId);
        if (!habit) continue;
        const today = habitDateKey(new Date());
        let completedDates = habit.completedDates;
        if (changes.checkInToday === true && !completedDates.includes(today)) completedDates = [...completedDates, today];
        if (changes.checkInToday === false) completedDates = completedDates.filter((date) => date !== today);
        await localStore.updateHabit({
          ...habit,
          ...(changes.title !== undefined ? { title: changes.title } : {}),
          ...(changes.important !== undefined ? { important: changes.important } : {}),
          ...(changes.urgent !== undefined ? { urgent: changes.urgent } : {}),
          ...(changes.interval !== undefined ? { interval: changes.interval } : {}),
          ...(changes.unit !== undefined ? { unit: changes.unit } : {}),
          ...(changes.daysOfWeek !== undefined ? { daysOfWeek: changes.daysOfWeek } : {}),
          ...(changes.endDate !== undefined ? { endDate: changes.endDate } : {}),
          completedDates,
        });
        if (changes.checkInToday === true && game.enabled) rewardHabitCheckIn(habit, today);
      } else if (item.kind === "note") {
        const note = notesStore.list().find((candidate) => candidate.id === item.targetId);
        if (!note) continue;
        const body = changes.bodyMarkdown !== undefined ? changes.bodyMarkdown : changes.appendMarkdown ? `${note.body.trimEnd()}\n\n${changes.appendMarkdown}` : note.body;
        notesStore.update({ ...note, ...(changes.title ? { title: changes.title } : {}), ...(changes.favorite !== undefined ? { favorite: changes.favorite } : {}), body });
      } else if (item.kind === "area") {
        const area = workspaceStore.listAreas().find((candidate) => candidate.id === item.targetId);
        if (!area) continue;
        workspaceStore.updateArea({ ...area, ...(changes.name ? { name: changes.name } : {}), ...(changes.icon ? { icon: changes.icon } : {}) });
      }
    }
    refreshWorkspace();
    await refresh();
    void syncNow();
  }

  /* Applies update_task proposals the user confirmed in the assistant. Only
     tasks that still exist and are editable are changed. */
  async function applyAgentTaskUpdates(batch: ProposedTaskUpdate[]) {
    const current = new Map((await localStore.listTasks()).map((task) => [task.id, task]));
    for (const item of batch) {
      const task = current.get(item.taskId);
      if (!task || task.deletedAt) continue;
      assertProjectWritable(task.projectId);
      const { changes } = item;
      const completed = changes.completed ?? (changes.status ? changes.status === "done" : task.completed);
      const status = changes.status ?? (changes.completed === true ? "done" : changes.completed === false && task.status === "done" ? "next" : task.status);
      const people = task.peopleIds ?? [];
      await localStore.updateTask({ ...task, ...changes, completed, status, ...(changes.assigneeId && !people.includes(changes.assigneeId) ? { peopleIds: [...people, changes.assigneeId] } : {}) });
    }
    await refresh();
    void syncNow("tasks");
  }

  async function addAgentHabits(batch: HabitDraft[]) {
    for (const item of batch) {
      await localStore.saveHabit(item);
    }
    await refresh();
    void syncNow("tasks");
  }

  function resolveAgentFolderId(folderName: string | null): string | null {
    if (!folderName) return null;
    const wanted = folderName.trim().toLowerCase();
    if (!wanted) return null;
    const existing = notesStore.listFolders().find((folder) => folder.name.trim().toLowerCase() === wanted);
    if (existing) return existing.id;
    return notesStore.createFolder(folderName.trim()).id;
  }

  async function addAgentFolders(batch: NoteFolderDraft[]) {
    for (const item of batch) {
      const name = item.name.trim();
      if (!name) continue;
      const wanted = name.toLowerCase();
      const parentWanted = item.parentName?.trim().toLowerCase() ?? null;
      const duplicate = notesStore.listFolders().some((folder) => {
        if (folder.name.trim().toLowerCase() !== wanted) return false;
        if (!parentWanted) return folder.parentId === null;
        const parent = notesStore.listFolders().find((candidate) => candidate.id === folder.parentId);
        return parent?.name.trim().toLowerCase() === parentWanted;
      });
      if (duplicate) continue;
      const parentId = item.parentName ? resolveAgentFolderId(item.parentName) : null;
      notesStore.createFolder(name, parentId);
    }
  }

  async function addAgentNotes(batch: NoteDraft[]) {
    for (const item of batch) {
      const title = item.title.trim() || t("common.notes.untitled");
      const folderId = resolveAgentFolderId(item.folderName);
      let projectId: string | null = null;
      if (item.projectName) {
        projectId = resolveAgentProjectId(item.projectName);
      }
      const created = notesStore.create(title, folderId, projectId);
      notesStore.update({ ...created, body: item.bodyMarkdown, favorite: item.favorite });
    }
    refreshWorkspace();
  }

  async function changeTask(task: Task) {
    assertProjectWritable(task.projectId);
    const previous = tasks.find((item) => item.id === task.id);
    const savedTask = await localStore.updateTask(task);
    if (previous && !previous.completed && task.completed) {
      retainCompletionExit(task.id);
      // Gamified: confetti and XP flying to the bar. Calm: the quiet toast.
      if (game.enabled) rewardTaskCompletion(savedTask);
      else setCompletionCelebration({ title: task.title, key: ++celebrationKey.current });
    } else if (!task.completed) {
      releaseCompletionExit(task.id);
      if (previous?.completed) revokeCompletion(task.id);
    }
    setTasks((current) => current.map((item) => item.id === savedTask.id ? savedTask : item));
    void refresh();
    void syncNow("tasks");
  }

  async function deleteTask(task: Task) {
    assertProjectWritable(task.projectId);
    await localStore.removeTask(task);
    releaseCompletionExit(task.id);
    await refresh();
    void syncNow("tasks");
  }

  async function saveHabit(input: HabitDraft) {
    await localStore.saveHabit(input);
    setHabitComposerOpen(false);
    setEditingHabit(null);
    await refresh();
    void syncNow("tasks");
  }

  async function completeHabit(habit: Habit, date: string) {
    const completedDates = habit.completedDates.includes(date)
      ? habit.completedDates.filter((value) => value !== date)
      : [...habit.completedDates, date];
    const savedHabit = await localStore.updateHabit({ ...habit, completedDates });
    if (!habit.completedDates.includes(date)) {
      if (game.enabled) rewardHabitCheckIn(habit, date);
      else setCompletionCelebration({ title: habit.title, key: ++celebrationKey.current });
    } else {
      revokeCompletion(`${habit.id}:${date}`);
    }
    setHabits((current) => current.map((item) => item.id === savedHabit.id ? savedHabit : item));
    void refresh();
    void syncNow("tasks");
  }

  async function changeHabit(habit: Habit) { await localStore.updateHabit(habit); await refresh(); void syncNow("tasks"); }
  async function deleteHabit(habit: Habit) { await localStore.removeHabit(habit); await refresh(); void syncNow("tasks"); }

  /* Viewers cannot edit, and shared projects live on the server: editing
     them offline would diverge from what the other members see. */
  function assertProjectWritable(projectId: string | null | undefined) {
    if (!projectId) return;
    if (collaborationStore.role(projectId) === "viewer") throw new Error(t("common.access.viewOnly"));
    if (collaborationStore.isShared(projectId) && !isOnline()) throw new Error(t("common.access.sharedOffline"));
  }

  async function saveProjectDetails(project: Project): Promise<void> {
    const entry = collaborationStore.get(project.id);
    assertProjectWritable(project.id);
    if (entry && entry.role !== "owner") {
      const token = await getToken();
      if (!token) throw new Error(t("common.access.signInToUpdate"));
      await api.updateCollaborativeProject(project.id, project, token);
      await collaborationStore.sync(token);
    } else {
      workspaceStore.updateProject(project);
    }
    refreshWorkspace();
    void syncNow();
  }

  /** The web address of a page, also from native builds (for sharing). */
  const webBase = isTauri() ? WEB_APP_URL.replace(/\/+$/, "") : window.location.origin;

  /** A shared project's token, or a prompt to sign in. */
  async function collaborationToken(): Promise<string> {
    const token = await getToken();
    if (!token) {
      setAuthOpen(true);
      throw new Error(t("common.access.signInToUpdate"));
    }
    return token;
  }

  /** A project must exist on the server before it can be shared. */
  async function ensureProjectOnServer(projectId: string, token: string): Promise<void> {
    if (collaborationStore.get(projectId)) return;
    await workspaceSync.sync(token);
    await collaborationStore.sync(token);
  }

  function planLimitMessage(error: PlanLimitError): string {
    const limits = billing.billing?.entitlements;
    return error.limit === "projects"
      ? t("billing.limits.projects", { count: limits?.maxSharedProjects ?? 3 })
      : t("billing.limits.members", { count: limits?.maxMembersPerProject ?? 2 });
  }

  /** Re-reads shared projects in the background after an optimistic change. */
  function refreshCollaboration(token: string): void {
    void collaborationStore.sync(token).catch((error) => logger.warn("sync", "Collaboration refresh failed", { error: String(error) }));
  }

  const collaborationByProject = useMemo<CollaborationByProject>(() => {
    const stateOptions = [
      { id: "backlog", name: t("common.states.backlog"), category: "backlog" as const },
      { id: "next", name: t("common.states.todo"), category: "unstarted" as const },
      { id: "in_progress", name: t("common.states.inProgress"), category: "started" as const },
      { id: "waiting", name: t("common.states.waiting"), category: "started" as const },
      { id: "done", name: t("common.states.done"), category: "completed" as const },
    ];
    // People the user already works with, suggested in every share dialog.
    const suggestionByEmail = new Map<string, Person>();
    for (const entry of collaborationStore.list()) {
      for (const member of entry.members) {
        if (member.userId === user?.id || !member.email) continue;
        suggestionByEmail.set(member.email.toLowerCase(), { id: member.userId, name: member.displayName || member.email, email: member.email, avatarUrl: member.avatarUrl });
      }
    }
    const suggestions = [...suggestionByEmail.values()].sort((left, right) => left.name.localeCompare(right.name));
    const result: Record<string, Omit<ProjectCollaborationProps, "project">> = {};
    for (const project of projects) {
      // The collaboration workspace is the default project experience. A
      // server entry enriches it with ACLs and members; local projects still
      // need to render the same workspace before the first authenticated sync.
      const entry = collaborationStore.get(project.id);
      const offline = !online && collaborationStore.isShared(project.id);
      const readOnly = entry?.role === "viewer" || offline;
      // Presence is real: the API marks members with a live connection.
      const members = entry?.members.map((member) => {
        const isSelf = member.userId === user?.id;
        const presence = isSelf || member.online ? "online" as const : undefined;
        return { id: member.userId, name: member.displayName || member.email, email: member.email, avatarUrl: member.avatarUrl, role: member.role, presence };
      }) ?? (user ? [{ id: user.id, name: user.displayName || user.email, email: user.email, avatarUrl: user.avatarUrl, role: "owner" as const, presence: "online" as const }] : []);
      const memberById = new Map(members.map((member) => [member.id, member]));
      // Assignment makes sense once someone else can see the project.
      const assignablePeople = entry && members.length > 1 ? members.map(({ id, name, email, avatarUrl, presence }) => ({ id, name, email, avatarUrl, presence })) : undefined;
      const projectTasks = tasks.filter((task) => task.projectId === project.id);
      const taskById = new Map(projectTasks.map((task) => [task.id, task]));
      // Linear-style links shown on cards: milestone, parent, blockers, sub-tasks.
      const issueLinks = (task: Task) => {
        const children = projectTasks.filter((child) => child.parentId === task.id && !child.deletedAt);
        const milestone = project.milestones?.find((item) => item.id === task.milestoneId);
        const parent = task.parentId ? taskById.get(task.parentId) : undefined;
        return {
          blocked: (task.relations ?? []).some((relation) => relation.type === "blocked_by" && taskById.get(relation.taskId)?.completed === false),
          ...(children.length ? { subtasks: { done: children.filter((child) => child.completed).length, total: children.length } } : {}),
          properties: [
            ...(milestone ? [{ key: "milestone" as const, label: milestone.name }] : []),
            ...(parent ? [{ key: "parent" as const, label: parent.title }] : []),
          ],
        };
      };
      const projectIssues = projectTasks.map((task) => {
        const rawState = task.completed ? "done" : task.status ?? "backlog";
        return {
        id: task.id,
        title: task.title,
        stateId: rawState === "inbox" ? "backlog" : rawState,
        priority: task.priority,
        assigneeId: task.assigneeId ?? null,
        ...issueLinks(task),
        people: (task.peopleIds ?? []).map((personId): TaskPerson | null => {
          const person = memberById.get(personId);
          return person ? { id: person.id, name: person.name, email: person.email, avatarUrl: person.avatarUrl, role: personId === task.peopleIds?.[0] ? "owner" : "collaborator", presence: person.presence } : null;
        }).filter((person): person is TaskPerson => Boolean(person)),
      };
      });
      result[project.id] = {
        issues: projectIssues,
        states: stateOptions,
        cycles: (project.cycles ?? []).map((cycle) => {
          const assigned = projectIssues.filter((issue) => cycle.issueIds?.includes(issue.id));
          const now = new Date();
          const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          return { ...cycle, phase: cycle.endsOn < today ? "past" as const : cycle.startsOn > today ? "upcoming" as const : "current" as const, dateLabel: `${cycle.startsOn} – ${cycle.endsOn}`, issueCount: assigned.length, completedCount: assigned.filter((issue) => issue.stateId === "done").length };
        }),
        readOnly,
        offline,
        onCreateIssue: readOnly ? undefined : (stateId) => openNewTask({ projectId: project.id, status: stateOptions.find((state) => state.id === stateId)?.id as Task["status"] ?? "backlog" }),
        onEditProject: readOnly ? undefined : () => setProjectEditor(project),
        onCreateCycle: readOnly ? undefined : () => setCycleEditor({ projectId: project.id }),
        onEditCycle: readOnly ? undefined : (cycleId) => setCycleEditor({ projectId: project.id, cycleId }),
        onCreateMilestone: readOnly ? undefined : () => setMilestoneEditor({ projectId: project.id }),
        onEditMilestone: readOnly ? undefined : (milestoneId) => setMilestoneEditor({ projectId: project.id, milestoneId }),
        onOpenNotes: () => openNotes(project.id),
        onOpenIssue: (id) => {
          const task = tasks.find((item) => item.id === id && item.projectId === project.id);
          if (task) { setComposerProjectId(task.projectId ?? null); setEditingTask(task); }
        },
        onDeleteIssue: readOnly ? undefined : (id) => {
          const task = tasks.find((item) => item.id === id && item.projectId === project.id);
          if (task) void deleteTask(task);
        },
        onMoveIssue: readOnly ? undefined : async (id, stateId) => {
          const task = tasks.find((item) => item.id === id && item.projectId === project.id);
          if (!task || !stateOptions.some((state) => state.id === stateId)) throw new Error(t("common.errors.moveFailed"));
          await changeTask({ ...task, status: stateId as Task["status"], completed: stateId === "done" });
        },
        assignablePeople,
        currentUserId: user?.id ?? null,
        onAssignIssue: readOnly || !assignablePeople ? undefined : async (id, personId) => {
          const task = tasks.find((item) => item.id === id && item.projectId === project.id);
          if (!task) return;
          await changeTask(withAssignee(task, personId));
        },
        loadActivity: async () => {
          const local = localProjectActivity(projectTasks, user?.id ?? null);
          const token = entry ? await getToken() : null;
          if (!token) return local;
          try {
            return (await api.projectActivity(project.id, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", token)).entries;
          } catch (error) {
            logger.warn("sync", "Project activity unavailable; showing this device's history", { error: String(error) });
            return local;
          }
        },
        sharing: {
          members,
          invites: (entry?.pendingInvites ?? []).map((invite) => ({ id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt })),
          // A project created on this device is ours even before its first
          // sync reaches the server; inviting uploads it first.
          canManage: entry ? entry.role === "owner" : Boolean(user),
          currentUserId: user?.id ?? null,
          suggestions,
          projectLink: `${webBase}/projects/${encodeURIComponent(project.id)}`,
          onInvite: async (email, role) => {
            const token = await collaborationToken();
            try {
              await ensureProjectOnServer(project.id, token);
              const response = await api.shareProject(project.id, email, role, token, lang);
              if (response.invite) {
                const invite = response.invite;
                collaborationStore.update(project.id, (current) => ({ ...current, pendingInvites: [invite, ...(current.pendingInvites ?? []).filter((item) => item.email.toLowerCase() !== invite.email.toLowerCase())] }));
                refreshCollaboration(token);
                const link = response.inviteLink ?? `${webBase}/invite/${encodeURIComponent(invite.inviteToken ?? "")}`;
                return { kind: "invited" as const, email: invite.email, link, emailSent: response.emailSent === true };
              }
              collaborationStore.update(project.id, (current) => ({ ...current, members: current.members.map((member) => member.email.toLowerCase() === email.toLowerCase() ? { ...member, role } : member) }));
              refreshCollaboration(token);
              return { kind: "member" as const, email, role };
            } catch (error) {
              if (error instanceof PlanLimitError) throw new Error(planLimitMessage(error));
              throw error;
            }
          },
          onResendInvite: async (inviteId, sendEmail) => {
            const token = await collaborationToken();
            const result = await api.resendProjectInvite(project.id, inviteId, { email: sendEmail, language: lang }, token);
            collaborationStore.update(project.id, (current) => ({ ...current, pendingInvites: (current.pendingInvites ?? []).map((invite) => invite.id === inviteId ? { ...invite, expiresAt: result.invite.expiresAt } : invite) }));
            return { link: result.inviteLink, emailSent: result.emailSent };
          },
          onRevokeInvite: async (inviteId) => {
            const token = await collaborationToken();
            await api.revokeProjectInvite(project.id, inviteId, token);
            collaborationStore.update(project.id, (current) => ({ ...current, pendingInvites: (current.pendingInvites ?? []).filter((invite) => invite.id !== inviteId) }));
            refreshCollaboration(token);
          },
          onRoleChange: async (userId, role) => {
            const token = await collaborationToken();
            const previous = collaborationStore.get(project.id)?.members.find((member) => member.userId === userId)?.role;
            // Optimistic: the select shows the new role while it saves.
            collaborationStore.update(project.id, (current) => ({ ...current, members: current.members.map((member) => member.userId === userId ? { ...member, role } : member) }));
            try {
              await api.updateProjectMember(project.id, userId, role, token);
            } catch (error) {
              if (previous) collaborationStore.update(project.id, (current) => ({ ...current, members: current.members.map((member) => member.userId === userId ? { ...member, role: previous } : member) }));
              throw error;
            }
            refreshCollaboration(token);
          },
          onRemoveMember: async (userId) => {
            const token = await collaborationToken();
            await api.removeProjectMember(project.id, userId, token);
            collaborationStore.update(project.id, (current) => ({ ...current, members: current.members.filter((member) => member.userId !== userId) }));
            refreshCollaboration(token);
          },
          onLeave: user && entry && entry.role !== "owner" ? async () => {
            const token = await collaborationToken();
            await api.removeProjectMember(project.id, user.id, token);
            collaborationStore.remove(project.id);
            openProject("");
            setToast(t("collab.share.left", { name: project.name }));
            void syncNow("shared");
          } : undefined,
        },
        overview: {
          lead: members.find((member) => member.role === "owner"), health: project.health ?? undefined, startDate: project.startDate ?? undefined, targetDate: project.targetDate ?? undefined,
          milestones: (project.milestones ?? []).map((milestone) => {
            const inMilestone = projectTasks.filter((task) => task.milestoneId === milestone.id && !task.deletedAt);
            const done = inMilestone.filter((task) => task.completed).length;
            return { id: milestone.id, name: milestone.name, targetDate: milestone.targetDate ?? null, done, total: inMilestone.length, completed: inMilestone.length > 0 && done === inMilestone.length };
          }),
        },
      };
    }
    return result;
  }, [openNewTask, projects, tasks, user, refreshWorkspace, t, lang, online, syncNow, billing.billing]);

  const taskPlanning = useMemo<TaskPlanningProps | undefined>(() => {
    const projectId = composerProjectId !== undefined ? composerProjectId : editingTask?.projectId ?? newTaskContext?.projectId;
    const entry = projectId ? collaborationStore.get(projectId) : undefined;
    const availablePeople: Person[] = (entry?.members ?? []).map((member) => ({ id: member.userId, name: member.displayName || member.email, email: member.email, avatarUrl: member.avatarUrl }));
    if (user && !availablePeople.some((person) => person.id === user.id)) availablePeople.unshift({ id: user.id, name: user.displayName || user.email, email: user.email, avatarUrl: user.avatarUrl });
    const selectedIds = editingTask && editingTask.projectId === projectId ? editingTask.peopleIds ?? [] : user ? [user.id] : [];
    const people: TaskPerson[] = selectedIds.map((personId) => {
      const person = availablePeople.find((item) => item.id === personId) ?? { id: personId, name: t("common.planning.unknownPerson") };
      return { ...person, role: personId === user?.id ? "owner" : "collaborator" };
    });
    const assignablePeople = entry && entry.members.length > 1 ? entry.members.map((member) => ({ id: member.userId, name: member.displayName || member.email, email: member.email, avatarUrl: member.avatarUrl })) : undefined;
    return {
      people,
      availablePeople,
      assignablePeople,
      assigneeId: editingTask && editingTask.projectId === projectId ? editingTask.assigneeId ?? null : null,
      currentUserId: user?.id ?? null,
      readOnly: entry?.role === "viewer" || Boolean(editingTask?.projectId && collaborationStore.role(editingTask.projectId) === "viewer"),
      fields: [
        { key: "state", label: t("common.planning.workflowState"), options: [{ id: "backlog", name: t("common.states.backlog") }, { id: "next", name: t("common.states.todo") }, { id: "in_progress", name: t("common.states.inProgress") }, { id: "done", name: t("common.states.done") }], selectedIds: [(() => { const raw = editingTask?.status ?? newTaskContext?.status ?? "backlog"; return raw === "inbox" ? "backlog" : raw; })()] },
      ],
    };
  }, [editingTask, newTaskContext, composerProjectId, user, projects, t]);

  // After DELETE /v1/me: wipe everything the account left on this device,
  // then return to the sign-in screen.
  useEffect(() => {
    const onDeleted = (event: Event) => {
      const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId ?? getAccountId();
      void (async () => {
        sessionGeneration.current += 1;
        realtimeGeneration.current += 1;
        const close = realtimeClose.current;
        realtimeClose.current = undefined;
        void close?.().catch(() => undefined);
        setIncomingInvites([]);
        await wipeAccountLocalData(accountId);
        await clearSession().catch((error) => console.warn("Prior could not clear the saved session:", error));
        setUser(null);
        setSelectedProjectId(null);
        setNotesProjectId(null);
        setTasks([]);
        setHabits([]);
        refreshWorkspace();
        setActiveView("today");
        setToast(t("account.danger.deleted"));
        await refresh().catch(() => undefined);
      })();
    };
    const onChallenge = () => setAuthOpen(true);
    const onVerified = () => { void syncNow(); };
    window.addEventListener(ACCOUNT_DELETED_EVENT, onDeleted);
    window.addEventListener(TWO_FACTOR_CHALLENGE_EVENT, onChallenge);
    window.addEventListener("prior-email-verified", onVerified);
    return () => {
      window.removeEventListener(ACCOUNT_DELETED_EVENT, onDeleted);
      window.removeEventListener(TWO_FACTOR_CHALLENGE_EVENT, onChallenge);
      window.removeEventListener("prior-email-verified", onVerified);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncNow]);

  async function logout() {
    const token = await getToken().catch(() => null);
    sessionGeneration.current += 1;
    setIncomingInvites([]);
    setMentions([]);
    realtimeGeneration.current += 1;
    const close = realtimeClose.current;
    realtimeClose.current = undefined;
    void close?.().catch((error) => console.warn("Prior realtime cleanup failed:", error));
    // Local logout must not wait for a network round trip. Remote revocation
    // is best-effort and the API client has a short timeout.
    await clearSession().catch((error) => console.warn("Prior could not clear the saved session:", error));
    await localStore.resetSyncRevision().catch((error) => console.warn("Prior could not reset sync state:", error));
    setUser(null);
    setAuthOpen(false);
    setSelectedProjectId(null);
    setNotesProjectId(null);
    setTasks([]);
    setHabits([]);
    refreshWorkspace();
    await refresh().catch((error) => console.warn("Prior could not refresh after sign-out:", error));
    if (token) void api.logout(token).catch(() => undefined);
  }

  const visibleTasks = useMemo(
    () => filterTasksWithExitingCompletions(tasks, taskFilters, completionExitDeadlines),
    [tasks, taskFilters, completionExitDeadlines],
  );

  const openTaskCount = useMemo(() => tasks.filter((task) => !task.completed).length, [tasks]);
  const myTasks = useMemo(() => tasksAssignedTo(tasks, user?.id), [tasks, user?.id]);
  const myVisibleTasks = useMemo(() => filterTasksWithExitingCompletions(myTasks, taskFilters, completionExitDeadlines), [myTasks, taskFilters, completionExitDeadlines]);
  const myOpenCount = useMemo(() => myTasks.filter((task) => !task.completed).length, [myTasks]);

  const grouped = useMemo(() => Object.fromEntries(QUADRANTS.map((quadrant) => [quadrant.key, visibleTasks.filter((task) => quadrantFor(task) === quadrant.key)])), [visibleTasks]);

  // Live navigation counts for the sidebar and the phone "More" screen.
  const waitingCount = useMemo(() => waitingTaskCount(tasks), [tasks]);
  const habitProgress = habitProgressForDay(habits);

  function handleAuthenticated(nextUser: SessionUser) {
    sessionGeneration.current += 1;
    setIncomingInvites([]);
    setUser(nextUser);
    setAuthError("");
    setAuthOpen(false);
    refreshWorkspace();
    void refresh().catch((error) => console.warn("Prior could not refresh after sign-in:", error));
    void attachRealtime().catch((error) => console.warn("Prior realtime attach failed:", error));
    void syncNow();
    void pullAssistantSettings().catch((error) => console.warn("Prior assistant settings pull failed:", error));
  }

  // Onboarding opens once the server says this account has steps it hasn't
  // seen, or when Settings → Game asks to replay it.
  useEffect(() => {
    if (user && game.needsOnboarding && !onboardingPutOff) setOnboardingOpen(true);
  }, [user, game.needsOnboarding, onboardingPutOff]);
  useEffect(() => {
    const replay = () => setOnboardingOpen(true);
    window.addEventListener(REPLAY_ONBOARDING_EVENT, replay);
    return () => window.removeEventListener(REPLAY_ONBOARDING_EVENT, replay);
  }, []);

  /** The onboarding's "first win": things on the user's mind, as Focus tasks. */
  async function createOnboardingTasks(titles: string[]): Promise<Task[]> {
    const created: Task[] = [];
    for (const title of titles) {
      created.push(await localStore.saveTask({ title, important: true, urgent: true, completed: false, peopleIds: user ? [user.id] : [] }));
    }
    await refresh();
    void syncNow("tasks");
    return created;
  }

  function handleUserUpdated(nextUser: SessionUser): void {
    saveUser(nextUser);
    setUser(nextUser);
  }

  async function respondToInvite(invite: IncomingProjectInvite, accept: boolean): Promise<void> {
    const token = await getToken();
    if (!token) { setAuthOpen(true); return; }
    try {
      await api.respondToInvite(invite.id, accept, token);
      setIncomingInvites((current) => current.filter((item) => item.id !== invite.id));
      await syncNow();
      if (accept) {
        openProject(invite.projectId);
        setToast(t("common.toasts.inviteJoined", { project: invite.projectName }));
      } else {
        setToast(t("common.toasts.inviteDeclined"));
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : t("common.errors.shareFailed"));
      void syncNow();
    }
  }

  function openProject(projectId: string): void {
    setProjectTab(null);
    setMobileMoreOpen(false);
    if (!projectId) {
      setSelectedProjectId(null);
      setActiveView("projects");
      return;
    }
    setSelectedProjectId(projectId);
    setActiveView("project");
  }

  function openNotes(projectId?: string): void {
    setNotesProjectId(projectId ?? null);
    setActiveView("notes");
  }

  function openWaiting(): void {
    setActiveView("waiting");
  }

  // One-tap update install from the banner: downloads, installs and
  // restarts the app (Windows stages the install and asks for a restart).
  async function installDesktopUpdate() {
    if (updateInstalling) return;
    setUpdateInstalling(true);
    try {
      await installAvailableUpdate();
      if (/Windows/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent)) {
        setToast(t("common.toasts.updateInstalled"));
      }
    } catch {
      setToast(t("common.errors.updateFailed"));
    } finally {
      setUpdateInstalling(false);
    }
  }

  function changeView(view: WorkspaceView): void {
    if (view !== "project") { setSelectedProjectId(null); setProjectTab(null); }
    if (view === "notes") setNotesProjectId(null);
    setSettingsTab(undefined);
    setMobileMoreOpen(false);
    setActiveView(view);
  }

  function openGameSettings(): void {
    changeView("settings");
    setSettingsTab("game");
  }

  async function googleLogin() {
    setAuthError("");
    try {
      // On Android, prefer the system account picker; fall back to the
      // browser OAuth flow when native sign-in is unavailable.
      if (isAndroidTauri()) {
        try {
          const nativeUser = await startNativeGoogleLogin();
          // A 2FA code step took over the sign-in surface.
          if (nativeUser === CHALLENGE_PENDING) {
            setAuthOpen(true);
            return;
          }
          if (nativeUser) {
            handleAuthenticated(nativeUser);
            return;
          }
          // Dismissed picker: stay on the account screen, no error.
          if (nativeUser === null) return;
        } catch {
          console.warn("Prior native Google sign-in unavailable, falling back to browser.");
        }
      }
      await startGoogleLogin();
      setAuthOpen(false);
    } catch {
      console.warn("Prior could not open Google sign-in.");
      setAuthError(t("common.errors.googleFailed"));
      setAuthOpen(true);
    }
  }

  const effectsIntensity = game.enabled && game.profile ? game.profile.effects : "off";

  function openSettingsTab(tab: SettingsTab): void {
    changeView("settings");
    setSettingsTab(tab);
    bumpSettingsKey();
  }

  const paletteCommands: PaletteCommand[] = [
    { id: "new-task", label: t("palette.commands.newTask"), keywords: "add create", icon: "plus", run: () => openNewTask() },
    { id: "new-habit", label: t("palette.commands.newHabit"), keywords: "add create", icon: "refresh", run: () => setHabitComposerOpen(true) },
    ...(["today", "inbox", "calendar", "projects", ...(user ? ["mine" as const] : []), "all", "waiting", "eisenhower", "habits", "notes", ...(game.enabled ? ["progress" as const] : [])] as WorkspaceView[]).map((view) => ({
      id: `view-${view}`, label: t("palette.commands.goTo", { view: viewTitle(view, t) }), keywords: "go open view", icon: "arrow" as const, run: () => changeView(view),
    })),
    ...(["general", "profile", "security", "notifications", "game", "assistant", "integrations"] as SettingsTab[]).map((tab) => ({
      id: `settings-${tab}`, label: t("palette.commands.settings", { tab: t(`settings.tabs.${tab}`) }), keywords: "settings preferences", icon: "gear" as const, run: () => openSettingsTab(tab),
    })),
    { id: "theme-light", label: t("palette.commands.themeLight"), keywords: "theme appearance", icon: "sun", run: () => setThemePreference("light") },
    { id: "theme-dark", label: t("palette.commands.themeDark"), keywords: "theme appearance", icon: "moon", run: () => setThemePreference("dark") },
    { id: "theme-system", label: t("palette.commands.themeSystem"), keywords: "theme appearance", icon: "sliders", run: () => setThemePreference("system") },
    ...(user ? [
      { id: "game-toggle", label: game.enabled ? t("palette.commands.gameOff") : t("palette.commands.gameOn"), keywords: "game gamified calm xp", icon: "award" as const, run: () => { void gameStore.updateSettings({ enabled: !game.enabled }).catch(() => setToast(t("palette.commands.gameFailed"))); } },
      { id: "sign-out", label: t("palette.commands.signOut"), keywords: "logout log out", icon: "logout" as const, run: () => { void logout(); } },
    ] : []),
  ];

  if (accountLink) {
    return <AccountLinkPage route={accountLink} onDone={() => setAccountLink(null)} />;
  }

  if (productionAuthRequired && !authReady) {
    return <main className="auth-required-page auth-required-loading" aria-live="polite">{t("common.actions.loading")}</main>;
  }

  if (productionAuthRequired && !user) {
    return <AuthGate authError={authError} onAuthenticated={handleAuthenticated} onGoogle={() => { void googleLogin(); }} />;
  }

  if (calendarConnection) {
    return <CalendarConnectionSuccess
      email={calendarConnection.email}
      error={calendarConnection.error}
      onOpenCalendar={() => { setCalendarConnection(null); setActiveView("calendar"); }}
      onRetry={() => { setCalendarConnection(null); void startGoogleCalendarConnect().catch(() => setToast(t("common.calendar.import.googleError"))); }}
      onClose={() => setCalendarConnection(null)}
    />;
  }

  if (user && onboardingOpen) {
    return (
      <EffectsProvider intensity={effectsIntensity}>
        <OnboardingFlow
          user={user}
          returning={tasks.length > 0 || habits.length > 0}
          onUserUpdated={handleUserUpdated}
          onCreateTasks={createOnboardingTasks}
          onCompleteTask={(task) => changeTask({ ...task, completed: true, status: "done" })}
          onFinish={() => { setOnboardingOpen(false); setOnboardingPutOff(true); changeView("today"); }}
          onLater={() => { setOnboardingOpen(false); setOnboardingPutOff(true); }}
        />
      </EffectsProvider>
    );
  }

  return (
    <EffectsProvider intensity={effectsIntensity}>
    <div className={`app-shell ${agentOpen ? "agent-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${isDesktop() ? "tauri-desktop" : ""} ${isMac() ? "platform-mac" : ""}`}>
      <DesktopTitleBar />
      <AppSidebar
        activeView={activeView}
        user={user}
        collapsed={sidebarCollapsed}
        agentOpen={agentOpen}
        counts={{ waiting: waitingCount, mine: myOpenCount }}
        aiShortcut={aiShortcut}
        updateAvailable={desktopUpdate !== null}
        updateInstalling={updateInstalling}
        onInstallUpdate={() => void installDesktopUpdate()}
        inert={composerOpen || editingTask !== null || mailComposerOpen || habitComposerOpen || authOpen || projectEditor !== null || cycleEditor !== null || milestoneEditor !== null}
        onViewChange={changeView}
        showAdmin={billing.billing?.isAdmin === true}
        showProgress={game.enabled}
        gameWidget={<GameSidebarWidget collapsed={sidebarCollapsed} onOpenProgress={() => changeView("progress")} />}
        onAccount={() => setAuthOpen(true)}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onToggleAgent={() => setAgentOpen((value) => !value)}
        syncing={syncing}
        syncIssue={syncIssue}
        onSync={() => void syncNow()}
      />

      <main className={`workspace ${activeView === "notes" ? "notes-workspace-page" : ""} ${activeView === "inbox" ? "mail-workspace-page" : ""} ${activeView === "calendar" ? "calendar-workspace-page" : ""}`} inert={composerOpen || editingTask !== null || mailComposerOpen || habitComposerOpen || authOpen || projectEditor !== null || cycleEditor !== null || milestoneEditor !== null || mobileMoreOpen}>
        <MobileTopBar view={activeView} title={viewTitle(activeView, t)} agentOpen={agentOpen} onAgent={() => setAgentOpen((value) => !value)} onSearch={() => setPaletteOpen(true)} />
        <VerifyEmailBanner key={user?.id ?? "anonymous"} user={user} />
        <WorkspaceHeader
          activeView={activeView}
          layout={layout}
          onLayoutChange={setLayout}
          shortcut={shortcut}
          shortcutKey={shortcutKey}
          onNewTask={() => activeView === "habits" ? setHabitComposerOpen(true) : openNewTask()}
          subtitle={activeView === "all" ? tp("tasks.list.activeCount", openTaskCount) : activeView === "mine" ? tp("tasks.list.activeCount", myOpenCount) : activeView === "eisenhower" ? tp("tasks.matrix.subtitle", visibleTasks.length) : undefined}
          extraActions={activeView === "eisenhower" ? <div className="scope-switch" role="group" aria-label={t("tasks.matrix.scopeLabel")}>
            <button type="button" aria-pressed={taskFilters.status === "open"} onClick={() => setTaskFilters({ ...taskFilters, status: "open" })}>{t("tasks.matrix.scopeActive")}</button>
            <button type="button" aria-pressed={taskFilters.status === "all"} onClick={() => setTaskFilters({ ...taskFilters, status: "all" })}>{t("tasks.matrix.scopeAll")}</button>
          </div> : undefined}
        />

        {(activeView === "all" || activeView === "mine" || activeView === "eisenhower") && <TaskFilters value={taskFilters} onChange={setTaskFilters} taskCount={activeView === "all" ? openTaskCount : activeView === "mine" ? myOpenCount : undefined} />}

        <CompletionExitProvider deadlines={completionExitDeadlines}>
          <WorkspaceContent
            key={user?.id ?? "anonymous"}
            settingsTab={settingsTab}
            settingsKey={settingsKey}
            onSettingsTabChange={setSettingsTab}
            onOpenGameSettings={openGameSettings}
            projectTab={projectTab}
            onProjectTabChange={setProjectTab}
            activeView={activeView}
            user={user}
            onUserUpdated={handleUserUpdated}
            layout={layout}
            grouped={grouped}
            tasks={tasks}
            visibleTasks={visibleTasks}
            myTasks={myTasks}
            myVisibleTasks={myVisibleTasks}
            habits={habits}
            onHabitAdd={() => setHabitComposerOpen(true)}
            onHabitComplete={completeHabit}
            onHabitChange={changeHabit}
            onHabitDelete={deleteHabit}
            onHabitEdit={(habit) => { setEditingHabit(habit); setHabitComposerOpen(true); }}
            onTaskChange={changeTask}
            onTaskDelete={deleteTask}
            onTaskEdit={(task) => { setComposerProjectId(task.projectId ?? null); setEditingTask(task); }}
            areas={areas}
            projects={projects}
            selectedProjectId={selectedProjectId}
            notesProjectId={notesProjectId}
            onOpenProject={openProject}
            onOpenNotes={openNotes}
            onOpenWaiting={openWaiting}
            onNewTask={openNewTask}
            taskFilters={taskFilters}
            onWorkspaceChange={refreshWorkspace}
            collaborationByProject={collaborationByProject}
            onMailCreateTask={(draft) => { openMailTask(draft); return Promise.resolve(); }}
            onMailCreateTaskAI={createMailTaskAI}
            onQuickAddTask={saveTask}
            onOpenAgent={() => setAgentOpen(true)}
            onViewChange={changeView}
            billing={billing}
          />
        </CompletionExitProvider>
        {visibleTasks.length === 0 && activeView === "all" && <button className="empty-add" type="button" onClick={() => openNewTask()}><Icon name="plus" /> {t("common.header.newTask")}</button>}
      </main>

      {mobileMoreOpen && <MobileMoreScreen
        activeView={activeView}
        user={user}
        syncing={syncing}
        syncIssue={syncIssue}
        onSync={() => void syncNow()}
        badges={{ mine: myOpenCount > 0 ? String(myOpenCount) : undefined, waiting: waitingCount > 0 ? String(waitingCount) : undefined, habits: habitProgress.total > 0 ? `${habitProgress.done}/${habitProgress.total}` : undefined }}
        agentOpen={agentOpen}
        onNavigate={changeView}
        showAdmin={billing.billing?.isAdmin === true}
        showProgress={game.enabled}
        onAgent={() => setAgentOpen(true)}
        onAccount={() => setAuthOpen(true)}
        onClose={() => setMobileMoreOpen(false)}
      />}
      <MobileTabBar
        activeView={activeView}
        moreOpen={mobileMoreOpen}
        createLabel={activeView === "habits" ? t("common.header.newHabit") : t("common.header.newTask")}
        inert={composerOpen || editingTask !== null || mailComposerOpen || habitComposerOpen || authOpen || projectEditor !== null || cycleEditor !== null || milestoneEditor !== null}
        onNavigate={changeView}
        onCreate={() => activeView === "habits" ? setHabitComposerOpen(true) : openNewTask()}
        onToggleMore={() => setMobileMoreOpen((value) => !value)}
      />

      <AgentSidebar
        open={agentOpen}
        inert={composerOpen || editingTask !== null || mailComposerOpen || habitComposerOpen || authOpen || projectEditor !== null || cycleEditor !== null || milestoneEditor !== null}
        onClose={() => setAgentOpen(false)}
        tasks={tasks}
        habits={habits}
        areas={areas}
        projects={projects}
        user={user}
        onAddTasks={addAgentTasks}
        onAddHabits={addAgentHabits}
        onAddNotes={addAgentNotes}
        onAddFolders={addAgentFolders}
        onAddAreas={addAgentAreas}
        onAddProjects={addAgentProjects}
        onApplyTaskUpdates={applyAgentTaskUpdates}
        onApplyEntityUpdates={applyAgentEntityUpdates}
        onOpenSettings={() => { setAgentOpen(false); changeView("settings"); }}
      />

      {(composerOpen || editingTask) && <TaskComposer key={editingTask?.id ?? "new"} task={editingTask ?? undefined} areas={areas} projects={projects} initialContext={newTaskContext} planning={taskPlanning} onProjectChange={setComposerProjectId} allowCreateMore={!editingTask} onSave={editingTask ? saveEditedTask : saveTask} onCancel={() => { setComposerOpen(false); setEditingTask(null); setNewTaskContext(undefined); setComposerProjectId(undefined); }} allTasks={tasks} onCreateSubtask={createSubtask} onOpenTask={(task) => { setComposerOpen(false); setComposerProjectId(task.projectId ?? null); setEditingTask(task); }} />}
      {mailComposerOpen && mailDraft && (
        <TaskComposer
          key="mail-task"
          areas={areas}
          projects={projects}
          initialContext={{ status: "inbox" }}
          task={{
            id: "", title: mailDraft.title, description: mailDraft.description ?? "",
            dueDate: mailDraft.dueDate ?? null, priority: mailDraft.priority ?? 4,
            completed: false, important: mailDraft.important, urgent: mailDraft.urgent,
            status: "inbox", createdAt: "", updatedAt: "", deletedAt: null,
          }}
          onSave={saveMailTask}
          onCancel={() => { setMailComposerOpen(false); setMailDraft(null); }}
        />
      )}
      {projectEditor && <ProjectEditor project={projectEditor} avatarUrl={user?.avatarUrl} onClose={() => setProjectEditor(null)} onSave={async (project) => { await saveProjectDetails(project); setProjectEditor(null); }} />}
      {cycleEditor && <ProjectCycleEditor
        cycle={projects.find((project) => project.id === cycleEditor.projectId)?.cycles?.find((cycle) => cycle.id === cycleEditor.cycleId)}
        issues={collaborationByProject[cycleEditor.projectId]?.issues ?? []}
        onClose={() => setCycleEditor(null)}
        onSave={async (draft) => {
          const project = projects.find((item) => item.id === cycleEditor.projectId);
          if (!project) throw new Error(t("common.errors.projectGone"));
          if (!draft.startsOn || !draft.endsOn) throw new Error(t("common.errors.chooseDates"));
          const cycle = { ...draft, startsOn: draft.startsOn, endsOn: draft.endsOn, id: cycleEditor.cycleId ?? crypto.randomUUID() };
          const cycles = cycleEditor.cycleId ? (project.cycles ?? []).map((item) => item.id === cycle.id ? cycle : item) : [...(project.cycles ?? []), cycle];
          await saveProjectDetails({ ...project, cycles });
          setCycleEditor(null);
        }}
      />}
      {milestoneEditor && (() => {
        const project = projects.find((item) => item.id === milestoneEditor.projectId);
        if (!project) return null;
        const milestone = project.milestones?.find((item) => item.id === milestoneEditor.milestoneId);
        const inMilestone = milestone ? tasks.filter((task) => task.projectId === project.id && task.milestoneId === milestone.id).map((task) => task.id) : [];
        // The issue list of the milestone is the tasks' milestoneId: update
        // the tasks that joined or left it along with the project.
        const retag = async (milestoneId: string | null, issueIds: readonly string[]) => {
          for (const task of tasks.filter((item) => item.projectId === project.id)) {
            const selected = issueIds.includes(task.id);
            if (selected && task.milestoneId !== milestoneId) await changeTask({ ...task, milestoneId });
            else if (!selected && milestoneId && task.milestoneId === milestoneId) await changeTask({ ...task, milestoneId: null });
          }
        };
        return <ProjectMilestoneEditor
          milestone={milestone}
          issues={collaborationByProject[project.id]?.issues ?? []}
          issueIds={inMilestone}
          onClose={() => setMilestoneEditor(null)}
          onSave={async (draft) => {
            const id = milestone?.id ?? generateUuid();
            const next = { id, name: draft.name, targetDate: draft.targetDate, ...(draft.description ? { description: draft.description } : {}) };
            const milestones = milestone ? (project.milestones ?? []).map((item) => item.id === id ? next : item) : [...(project.milestones ?? []), next];
            await saveProjectDetails({ ...project, milestones, updatedAt: new Date().toISOString() });
            await retag(id, draft.issueIds);
          }}
          onDelete={milestone ? async () => {
            await saveProjectDetails({ ...project, milestones: (project.milestones ?? []).filter((item) => item.id !== milestone.id), updatedAt: new Date().toISOString() });
            await retag(milestone.id, []);
          } : undefined}
        />;
      })()}
      {habitComposerOpen && <HabitComposer habit={editingHabit ?? undefined} onSave={saveHabit} onCancel={() => { setHabitComposerOpen(false); setEditingHabit(null); }} />}
      {authOpen && <AccountDialog user={user} authError={authError} onClose={() => { setAuthOpen(false); setAuthError(""); }} onAuthenticated={handleAuthenticated} onGoogle={() => { void googleLogin(); }} onLogout={logout} onSettings={() => { setAuthOpen(false); setAuthError(""); changeView("settings"); }} />}
      {completionCelebration && <div className="completion-celebration" role="status" aria-live="polite"><span className="completion-celebration-icon"><Icon name="check" /><CompletionBurst trigger={completionCelebration.key} /></span><span><strong>{t("common.celebration.completed")}</strong><small>{completionCelebration.title}</small></span></div>}
      {user && <ProjectInviteNotifications invites={incomingInvites} onRespond={respondToInvite} />}
      {user && <MentionNotifications mentions={mentions} onRead={readMentions} onOpen={async (mention) => { await readMentions([mention.commentId]); openTargetUrl(`prior://task/${encodeURIComponent(mention.taskId)}`); }} />}
      {toast && <div className="completion-celebration" role="status" aria-live="polite"><span><strong>{t("common.celebration.notice")}</strong><small>{toast}</small></span><button type="button" aria-label={t("common.actions.dismiss")} onClick={() => setToast(null)}>✕</button></div>}
      {user && game.enabled && <GameCelebrations onOpenChest={setChestToOpen} />}
      {paletteOpen && <CommandPalette
        tasks={tasks}
        habits={habits}
        notes={notesStore.list()}
        projects={projects}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onOpenTask={(task) => { setComposerProjectId(task.projectId ?? null); setEditingTask(task); }}
        onOpenHabit={() => changeView("habits")}
        onOpenNote={(note) => { requestNoteOpen(note.id); openNotes(note.projectId ?? undefined); }}
        onOpenProject={(project) => openProject(project.id)}
      />}
      {chestDialog && <ChestDialog chest={chestDialog} onClose={() => setChestToOpen(null)} />}
    </div>
    </EffectsProvider>
  );
}
