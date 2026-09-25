import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { MailLabel, MailMessage, TaskDraft } from "../types";
import { useI18n } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";
import { AgentIdentity } from "./AgentIdentity";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useModalDialog } from "../hooks/useModalDialog";
import { resolveMailProvider, type MailProvider } from "../lib/mail";
import { mailCacheKey, readMailCache, writeMailCache } from "../lib/mailCache";
import { sanitizeMailHtml } from "../lib/mailHtml";
import { openExternalUrl } from "../lib/browser";
import { isTauri } from "../lib/platform";
import { clearMailAccount, disconnectMailAccount, emitMailAccountChange, getMailAccount, listMailAccounts, makeGmailTokenGetter, saveMailAccount, startGmailConnect, MAIL_ACCOUNT_EVENT } from "../lib/mailAuth";
import { getToken } from "../lib/auth";
import type { SessionUser } from "../lib/auth";
import "./MailView.css";

const FOLDERS: Array<{ id: string; labelFilter: string; icon: IconName }> = [
  { id: "inbox", labelFilter: "INBOX", icon: "inbox" },
  { id: "starred", labelFilter: "STARRED", icon: "star" },
  { id: "sent", labelFilter: "SENT", icon: "send" },
  { id: "all", labelFilter: "", icon: "mail" },
  { id: "trash", labelFilter: "TRASH", icon: "trash" },
];

type MailViewProps = {
  readonly user: SessionUser | null;
  readonly onCreateTask: (draft: TaskDraft) => Promise<void>;
  readonly onCreateTaskAI: (message: MailMessage) => Promise<void>;
};

/* Muted avatar tones from the Prior kit: stable per sender, never neon. */
const AVATAR_TONES = ["#c77b58", "#5b7fb8", "#7c9b70", "#8a6fb5", "#3d8a82", "#b8913f"];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatMailDate(iso: string, lang: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const sameYear = date.getFullYear() === now.getFullYear();
  try {
    if (sameDay) return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(date);
    if (sameYear) return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(date);
    return new Intl.DateTimeFormat(lang, { year: "numeric", month: "short", day: "numeric" }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

function formatReaderDate(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

/** Gmail label colors become soft tinted chips (tint background, deep text). */
function LabelChip({ label }: { readonly label: MailLabel }) {
  const style = label.color ? ({ "--chip": label.color } as React.CSSProperties) : undefined;
  return <span className={`mail-chip${label.color ? " tinted" : ""}`} style={style}>{label.name}</span>;
}

function PaperclipGlyph() {
  return (
    <svg className="mail-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg className="mail-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function MailView({ user, onCreateTask, onCreateTaskAI }: MailViewProps) {
  const { t, tp, lang } = useI18n();
  const mailMenu = useContextMenu();

  const [provider, setProvider] = useState<MailProvider | null>(null);
  const [providerKind, setProviderKind] = useState<"gmail" | "demo" | "none">("none");
  /* False until the first provider resolution settles, so the connect state
     never flashes while the account lookup is still in flight. */
  const [resolved, setResolved] = useState(false);
  const [labels, setLabels] = useState<MailLabel[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [folder, setFolder] = useState("inbox");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [inboxUnread, setInboxUnread] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tagsFor, setTagsFor] = useState<MailMessage | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "read">("list");
  const [account, setAccount] = useState(getMailAccount());
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const aiBusyRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /* Bumped when the Gmail connection changes (OAuth return, disconnect).
     Native shells never reload on return, so the provider resolution below
     must re-run from this instead of a page load. */
  const [accountNonce, setAccountNonce] = useState(0);

  const currentFolder = FOLDERS.find((f) => f.id === folder) ?? FOLDERS[0];
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const customLabels = useMemo(() => labels.filter((l) => !l.system), [labels]);

  /* Stale-while-revalidate: the last known list shows instantly, a fresh
     fetch replaces it in the background. Keyed per account + folder + query. */
  const cacheKey = useMemo(
    () => mailCacheKey({
      provider: providerKind,
      account: account?.email ?? "none",
      folder,
      label: activeLabel ?? "",
      query: debouncedQuery,
    }),
    [providerKind, account?.email, folder, activeLabel, debouncedQuery],
  );
  const messagesRef = useRef<MailMessage[]>([]);
  messagesRef.current = messages;
  const lastFetchRef = useRef(0);

  /* Resolve the provider: a Gmail provider when the server knows a connected
     account for this Prior session. The local demo provider remains available
     only in development so production never displays fabricated mail. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const local = getMailAccount();
      const session = await getToken();
      if (session) {
        try {
          const accounts = await listMailAccounts(session);
          const newest = accounts[0] ?? null;
          if (newest) {
            saveMailAccount({ email: newest.email, connectedAt: newest.connectedAt });
            if (!cancelled) {
              setAccount({ email: newest.email, connectedAt: newest.connectedAt });
              setProvider(resolveMailProvider(newest.email, makeGmailTokenGetter(session)));
              setProviderKind("gmail");
              setResolved(true);
            }
            return;
          }
        } catch {
          // API unreachable or unauthorized: keep the inbox disconnected.
        }
      }
      if (!cancelled) {
        setAccount(null);
        if (import.meta.env.DEV) {
          const mod = await import("../lib/mail");
          setProvider(new mod.DemoProvider(local?.email ?? "you@example.com"));
          setProviderKind("demo");
        } else {
          setProvider(null);
          setProviderKind("none");
        }
        setResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, accountNonce]);

  useEffect(() => {
    const onAccountChange = () => {
      setConnectOpen(false);
      setInboxUnread(null);
      setAccountNonce((n) => n + 1);
    };
    window.addEventListener(MAIL_ACCOUNT_EVENT, onAccountChange);
    return () => window.removeEventListener(MAIL_ACCOUNT_EVENT, onAccountChange);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 280);
    return () => window.clearTimeout(id);
  }, [query]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async (reset: boolean, pageToken?: string) => {
    if (!provider) return undefined;
    const labelFilter = activeLabel ?? currentFolder.labelFilter;
    const result = await provider.listMessages(labelFilter, debouncedQuery, pageToken);
    lastFetchRef.current = Date.now();
    setNextPageToken(result.nextPageToken);
    if (reset) {
      setMessages(result.messages);
      writeMailCache(cacheKey, result.messages, result.nextPageToken);
    } else {
      setMessages((prev) => [...prev, ...result.messages]);
    }
    return result;
  }, [provider, activeLabel, currentFolder.labelFilter, debouncedQuery, cacheKey]);

  useEffect(() => {
    if (!provider) return;
    void provider.listLabels().then(setLabels).catch(() => setLabels([]));
  }, [provider]);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    // Show the cached list instantly when there is one; the fresh fetch
    // below replaces it in the background.
    const cached = readMailCache(cacheKey);
    setMessages(cached?.messages ?? []);
    setNextPageToken(cached?.nextPageToken);
    setSelectedId(null);
    setMobilePane("list");
    setLoading(!cached);
    setRefreshing(!!cached);
    void load(true)
      .catch(() => { if (!cached) showToast(t("mail.toasts.updateFailed")); })
      .finally(() => { if (!cancelled) { setLoading(false); setRefreshing(false); } });
    return () => { cancelled = true; };
  }, [provider, load, cacheKey, showToast, t]);

  const refresh = useCallback(async () => {
    if (!provider) return;
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }, [provider, load]);

  /* Silent background refresh: no spinners, just picks up new mail. Runs on
     a timer and whenever the window regains focus. */
  const silentRefresh = useCallback(async () => {
    if (!provider || document.hidden) return;
    if (Date.now() - lastFetchRef.current < 30_000) return;
    const before = new Set(messagesRef.current.map((m) => m.id));
    const hadAny = before.size > 0;
    try {
      const result = await load(true);
      if (!result || !hadAny) return;
      const fresh = result.messages.filter((m) => !before.has(m.id)).length;
      if (fresh > 0) showToast(tp("mail.toasts.newMail", fresh));
    } catch {
      // Silent: keep showing the cached list.
    }
  }, [provider, load, showToast, tp]);

  useEffect(() => {
    if (!provider) return;
    const id = window.setInterval(() => { void silentRefresh(); }, 60_000);
    const onVisible = () => { void silentRefresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [provider, silentRefresh]);

  const applyModify = useCallback(async (message: MailMessage, add: string[], remove: string[]) => {
    if (!provider) return;
    try {
      const updated = await provider.modify(message.id, add, remove);
      setMessages((prev) => {
        const stillHere = (() => {
          const lf = activeLabel ?? currentFolder.labelFilter;
          if (lf === "INBOX") return updated.labelIds.includes("INBOX") && !updated.archived;
          if (lf === "STARRED") return updated.starred;
          if (lf === "SENT") return updated.labelIds.includes("SENT");
          if (lf === "TRASH") return updated.labelIds.includes("TRASH");
          if (lf) return updated.labelIds.includes(lf);
          return !updated.labelIds.includes("TRASH");
        })();
        if (!stillHere) return prev.filter((m) => m.id !== message.id);
        return prev.map((m) => (m.id === message.id ? updated : m));
      });
    } catch {
      showToast(t("mail.toasts.updateFailed"));
    }
  }, [provider, activeLabel, currentFolder.labelFilter, showToast, t]);

  const archive = useCallback((m: MailMessage) => {
    void applyModify(m, [], ["INBOX"]).then(() => showToast(t("mail.toasts.archived")));
  }, [applyModify, showToast, t]);
  const unarchive = useCallback((m: MailMessage) => {
    void applyModify(m, ["INBOX"], []).then(() => showToast(t("mail.toasts.unarchived")));
  }, [applyModify, showToast, t]);
  const toggleStar = useCallback((m: MailMessage) => {
    void applyModify(m, m.starred ? [] : ["STARRED"], m.starred ? ["STARRED"] : []);
  }, [applyModify]);
  const toggleRead = useCallback((m: MailMessage) => {
    void applyModify(m, m.unread ? [] : ["UNREAD"], m.unread ? ["UNREAD"] : []);
  }, [applyModify]);
  const remove = useCallback((m: MailMessage) => {
    void applyModify(m, ["TRASH"], ["INBOX"]).then(() => showToast(t("mail.toasts.deleted")));
    if (selectedId === m.id) {
      setSelectedId(null);
      setMobilePane("list");
    }
  }, [applyModify, showToast, selectedId, t]);

  const selectMessage = useCallback((m: MailMessage) => {
    setSelectedId(m.id);
    setMobilePane("read");
    if (m.unread) void applyModify(m, [], ["UNREAD"]);
  }, [applyModify]);

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setCheckedIds(new Set());
    setSelectMode(false);
  }, []);

  const bulkArchive = useCallback(() => {
    const targets = messages.filter((m) => checkedIds.has(m.id));
    for (const m of targets) void applyModify(m, [], ["INBOX"]);
    exitSelectMode();
    showToast(t("mail.toasts.archived"));
  }, [messages, checkedIds, applyModify, exitSelectMode, showToast, t]);

  const bulkDelete = useCallback(() => {
    const targets = messages.filter((m) => checkedIds.has(m.id));
    for (const m of targets) void applyModify(m, ["TRASH"], ["INBOX"]);
    exitSelectMode();
    showToast(t("mail.toasts.deleted"));
  }, [messages, checkedIds, applyModify, exitSelectMode, showToast, t]);

  const bulkMarkRead = useCallback(() => {
    const targets = messages.filter((m) => checkedIds.has(m.id));
    for (const m of targets) void applyModify(m, [], ["UNREAD"]);
    exitSelectMode();
  }, [messages, checkedIds, applyModify, exitSelectMode]);

  const createTaskAI = useCallback(async (message: MailMessage): Promise<void> => {
    if (aiBusyRef.current) return;
    aiBusyRef.current = message.id;
    setAiBusyId(message.id);
    try {
      await onCreateTaskAI(message);
    } finally {
      if (aiBusyRef.current === message.id) {
        aiBusyRef.current = null;
        setAiBusyId(null);
      }
    }
  }, [onCreateTaskAI]);

  const buildMenuItems = useCallback((m: MailMessage): ContextMenuItem[] => {
    return [
      { label: t("mail.menu.addToTask"), icon: "plus", run: () => void onCreateTask(taskDraftFromMail(m, t)) },
      { label: t("mail.menu.addToTaskAI"), icon: "sparkles", run: () => void createTaskAI(m) },
      { label: t("mail.menu.tags"), icon: "tag", run: () => setTagsFor(m) },
      m.archived || !m.labelIds.includes("INBOX")
        ? { label: t("mail.menu.unarchive"), icon: "inbox", run: () => unarchive(m) }
        : { label: t("mail.menu.archive"), icon: "archive", run: () => archive(m) },
      m.starred
        ? { label: t("mail.menu.unstar"), icon: "star", run: () => toggleStar(m) }
        : { label: t("mail.menu.star"), icon: "star", run: () => toggleStar(m) },
      m.unread
        ? { label: t("mail.menu.markRead"), icon: "eye", run: () => toggleRead(m) }
        : { label: t("mail.menu.markUnread"), icon: "mail", run: () => toggleRead(m) },
      { label: t("mail.menu.delete"), icon: "trash", danger: true, run: () => remove(m) },
    ];
  }, [t, onCreateTask, createTaskAI, archive, unarchive, toggleStar, toggleRead, remove]);

  const toggleTag = useCallback((labelId: string) => {
    if (!tagsFor) return;
    const has = tagsFor.labelIds.includes(labelId);
    void applyModify(tagsFor, has ? [] : [labelId], has ? [labelId] : []);
    setTagsFor((prev) => (prev ? {
      ...prev,
      labelIds: has ? prev.labelIds.filter((l) => l !== labelId) : [...prev.labelIds, labelId],
    } : prev));
  }, [tagsFor, applyModify]);

  const disconnect = useCallback(() => {
    void (async () => {
      const session = await getToken();
      if (session) {
        try {
          const accounts = await listMailAccounts(session);
          for (const serverAccount of accounts) {
            try { await disconnectMailAccount(session, serverAccount.id); } catch { /* keep going */ }
          }
        } catch { /* API unreachable: still clear locally */ }
      }
      clearMailAccount();
      setAccount(null);
      setProvider(null);
      emitMailAccountChange();
    })();
  }, []);

  const selectedMessage = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const unreadLoaded = useMemo(() => messages.filter((m) => m.unread).length, [messages]);
  /* The open message stays listed under "Unread" even after opening it marks
     it read, so the row never vanishes from under the pointer. */
  const visibleMessages = useMemo(
    () => (unreadOnly ? messages.filter((m) => m.unread || m.id === selectedId) : messages),
    [messages, unreadOnly, selectedId],
  );

  /* The rail count reflects the last loaded plain inbox list (no label, no
     search), so it stays meaningful while browsing other folders. */
  const isPlainInbox = folder === "inbox" && !activeLabel && !debouncedQuery;
  useEffect(() => {
    if (isPlainInbox && !loading) setInboxUnread(unreadLoaded);
  }, [isPlainInbox, loading, unreadLoaded]);

  const openFolder = useCallback((id: string) => {
    setFolder(id);
    setActiveLabel(null);
  }, []);
  const openLabel = useCallback((id: string) => {
    setActiveLabel((current) => (current === id ? null : id));
  }, []);

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) setQuery("");
      else window.setTimeout(() => searchRef.current?.focus(), 0);
      return !open;
    });
  }, []);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((v) => !v);
    setCheckedIds(new Set());
  }, []);

  const openMobileMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const items: ContextMenuItem[] = [
      { label: t("mail.actions.refresh"), icon: "refresh", run: () => void refresh() },
      { label: selectMode ? t("mail.view.doneSelecting") : t("mail.actions.select"), icon: "check-circle", run: toggleSelectMode },
      account && providerKind === "gmail"
        ? { label: t("mail.actions.disconnect"), icon: "logout", danger: true, run: disconnect }
        : { label: t("mail.actions.connect"), icon: "google", run: () => setConnectOpen(true) },
    ];
    mailMenu.openMenuAt(rect.right - 220, rect.bottom + 6, items);
  }, [t, refresh, selectMode, toggleSelectMode, account, providerKind, disconnect, mailMenu]);

  /* Arrow keys walk the list like a native mail client. */
  const onListKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains("mail-row-hit")) return;
    const hits = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(".mail-row-hit") ?? []);
    const index = hits.indexOf(target as HTMLButtonElement);
    const next = hits[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }, []);

  /* ---------------- Render ---------------- */

  const disconnected = resolved && !provider;
  const isDemo = providerKind === "demo";
  const listTitle = activeLabel ? (labelById.get(activeLabel)?.name ?? t("mail.labels")) : t(`mail.folders.${folder}`);
  const showSearchRow = searchOpen || query.length > 0;

  if (disconnected) {
    return (
      <section className="mail-view is-disconnected" aria-label={t("mail.title")}>
        <div className="mail-connect-state">
          <ConnectContent headingLevel="h1" />
        </div>
      </section>
    );
  }

  return (
    <section className="mail-view" aria-label={t("mail.title")}>
      <aside className="mail-rail">
        <nav className="mail-folders" aria-label={t("mail.view.folderNav")}>
          {FOLDERS.map((f) => {
            const active = folder === f.id && !activeLabel;
            const count = f.id === "inbox" && inboxUnread ? inboxUnread : 0;
            return (
              <button
                key={f.id}
                type="button"
                className={`mail-folder${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => openFolder(f.id)}
              >
                <Icon name={f.icon} />
                <span className="mail-folder-name">{t(`mail.folders.${f.id}`)}</span>
                {count > 0 && (
                  <span className="mail-folder-count">
                    <span aria-hidden="true">{count}</span>
                    <span className="mail-sr">{tp("mail.view.unreadCount", count)}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {customLabels.length > 0 && (
          <div className="mail-labels-block" role="group" aria-labelledby="mail-labels-title">
            <p className="mail-rail-title" id="mail-labels-title">{t("mail.labels")}</p>
            {customLabels.map((label) => (
              <button
                key={label.id}
                type="button"
                className={`mail-label${activeLabel === label.id ? " active" : ""}`}
                aria-pressed={activeLabel === label.id}
                onClick={() => openLabel(label.id)}
              >
                <span className="mail-label-dot" style={{ background: label.color ?? "var(--faint)" }} aria-hidden="true" />
                <span className="mail-label-name">{label.name}</span>
              </button>
            ))}
          </div>
        )}
        {account && providerKind === "gmail" ? (
          <div className="mail-account">
            <span className="mail-account-badge" aria-hidden="true"><Icon name="google" /></span>
            <div className="mail-account-text">
              <span className="mail-account-title">{t("mail.view.account")}</span>
              <span className="mail-account-email" title={account.email}>{account.email}</span>
            </div>
            <button type="button" className="mail-ghost-btn" onClick={disconnect}>{t("mail.actions.disconnect")}</button>
          </div>
        ) : (
          <button type="button" className="mail-account connect" onClick={() => setConnectOpen(true)}>
            <span className="mail-account-badge" aria-hidden="true"><Icon name="google" /></span>
            <span className="mail-account-text">
              <span className="mail-account-title">{t("mail.connect.demoBanner")}</span>
              <span className="mail-account-email">{t("mail.actions.connect")}</span>
            </span>
            <Icon name="chevron-right" />
          </button>
        )}
      </aside>

      <div className={`mail-list-pane${mobilePane === "read" ? " mobile-hidden" : ""}`}>
        <header className="mail-list-head">
          <h1 className="mail-list-title">{listTitle}</h1>
          <div className="mail-seg" role="group" aria-label={t("mail.view.filterLabel")}>
            <button type="button" className={!unreadOnly ? "on" : ""} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
              {t("mail.view.filterAll")}
            </button>
            <button type="button" className={unreadOnly ? "on" : ""} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
              {t("mail.view.filterUnread")}
              {unreadLoaded > 0 && <span className="mail-seg-count">{unreadLoaded}</span>}
            </button>
          </div>
          <div className="mail-head-actions">
            <button
              type="button"
              className={`mail-icon-btn${showSearchRow ? " active" : ""}`}
              aria-label={showSearchRow ? t("mail.view.searchClose") : t("mail.view.searchOpen")}
              aria-expanded={showSearchRow}
              onClick={toggleSearch}
            >
              <Icon name={showSearchRow ? "close" : "search"} />
            </button>
            <button type="button" className="mail-icon-btn" title={t("mail.view.more")} aria-label={t("mail.view.more")} aria-haspopup="menu" onClick={openMobileMenu}>
              <MoreGlyph />
            </button>
          </div>
        </header>

        <div className={`mail-toolbar${showSearchRow ? " search-open" : ""}`}>
          <label className="mail-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={t("mail.searchPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("mail.searchPlaceholder")}
            />
            {query && (
              <button type="button" className="mail-search-clear" aria-label={t("common.actions.dismiss")} onClick={() => setQuery("")}>
                <Icon name="close" />
              </button>
            )}
          </label>
          <button type="button" className={`mail-icon-btn desktop-only${refreshing ? " spinning" : ""}`} title={t("mail.actions.refresh")} aria-label={t("mail.actions.refresh")} onClick={() => void refresh()}>
            <Icon name="refresh" />
          </button>
          <button
            type="button"
            className={`mail-icon-btn desktop-only${selectMode ? " active" : ""}`}
            title={t("mail.actions.select")}
            aria-label={t("mail.actions.select")}
            aria-pressed={selectMode}
            onClick={toggleSelectMode}
          >
            <Icon name="check-circle" />
          </button>
        </div>

        <nav className="mail-tabs" aria-label={t("mail.view.folderNav")}>
          {FOLDERS.map((f) => {
            const active = folder === f.id && !activeLabel;
            return (
              <button key={f.id} type="button" className={`mail-tab${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => openFolder(f.id)}>
                {t(`mail.folders.${f.id}`)}
              </button>
            );
          })}
          {customLabels.map((label) => (
            <button key={label.id} type="button" className={`mail-tab${activeLabel === label.id ? " active" : ""}`} aria-pressed={activeLabel === label.id} onClick={() => openLabel(label.id)}>
              <span className="mail-label-dot" style={{ background: label.color ?? "var(--faint)" }} aria-hidden="true" />
              {label.name}
            </button>
          ))}
        </nav>

        {selectMode && (
          <div className="mail-bulkbar" role="toolbar" aria-label={t("mail.actions.select")}>
            <span className="mail-bulk-count" aria-live="polite">{tp("mail.view.selectedCount", checkedIds.size)}</span>
            <button type="button" className="mail-icon-btn" disabled={!checkedIds.size} title={t("mail.actions.archive")} aria-label={t("mail.actions.archive")} onClick={bulkArchive}><Icon name="archive" /></button>
            <button type="button" className="mail-icon-btn" disabled={!checkedIds.size} title={t("mail.actions.markRead")} aria-label={t("mail.actions.markRead")} onClick={bulkMarkRead}><Icon name="eye" /></button>
            <button type="button" className="mail-icon-btn danger" disabled={!checkedIds.size} title={t("mail.actions.delete")} aria-label={t("mail.actions.delete")} onClick={bulkDelete}><Icon name="trash" /></button>
            <button type="button" className="mail-ghost-btn" onClick={exitSelectMode}>{t("mail.view.doneSelecting")}</button>
          </div>
        )}

        {isDemo && (
          <button type="button" className="mail-demo-banner" onClick={() => setConnectOpen(true)}>
            <span className="mail-demo-badge" aria-hidden="true"><Icon name="google" /></span>
            <span className="mail-demo-text"><strong>{t("mail.connect.demoBanner")}</strong><span>{t("mail.connect.demoHint")}</span></span>
            <Icon name="chevron-right" />
          </button>
        )}

        <div className="mail-list" role="list" aria-label={t("mail.view.listLabel")} aria-busy={loading} ref={listRef} onKeyDown={onListKeyDown}>
          {loading && messages.length === 0 && <MailListSkeleton label={t("mail.view.loading")} />}
          {!loading && visibleMessages.length === 0 && (
            <div className="mail-empty" role="listitem">
              <span className="mail-empty-icon" aria-hidden="true"><Icon name={debouncedQuery ? "search" : "inbox"} /></span>
              <p className="mail-empty-title">{debouncedQuery ? t("mail.empty.title") : t("mail.empty.inbox")}</p>
              {debouncedQuery && <p className="mail-empty-hint">{t("mail.empty.search", { query: debouncedQuery })}</p>}
              {!debouncedQuery && unreadOnly && messages.length > 0 && <p className="mail-empty-hint">{t("mail.view.noUnread")}</p>}
            </div>
          )}
          {visibleMessages.map((m) => (
            <MailRow
              key={m.id}
              message={m}
              labels={m.labelIds.map((id) => labelById.get(id)).filter((l): l is MailLabel => Boolean(l && !l.system))}
              isSelected={selectedId === m.id}
              isChecked={checkedIds.has(m.id)}
              selectMode={selectMode}
              lang={lang}
              onSelect={() => (selectMode ? toggleChecked(m.id) : selectMessage(m))}
              onToggleStar={() => toggleStar(m)}
              onContextMenu={(e) => mailMenu.openMenu(e, buildMenuItems(m))}
              longPress={mailMenu.longPress(() => buildMenuItems(m))}
              starLabel={m.starred ? t("mail.actions.unstar") : t("mail.actions.star")}
              unreadLabel={t("mail.view.unread")}
              attachmentLabel={t("mail.view.attachments")}
              aiBusy={aiBusyId === m.id}
              aiBusyLabel={t("mail.ai.generating")}
            />
          ))}
          {nextPageToken && !loading && (
            <div role="listitem" className="mail-load-more-wrap">
              <button type="button" className="mail-load-more" onClick={() => void load(false, nextPageToken)}>
                {t("mail.actions.loadMore")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`mail-read-pane${mobilePane === "list" ? " mobile-hidden" : ""}`}>
        {selectedMessage ? (
          <MailReader
            key={selectedMessage.id}
            message={selectedMessage}
            labelById={labelById}
            canTag={customLabels.length > 0}
            onBack={() => setMobilePane("list")}
            onArchive={() => archive(selectedMessage)}
            onUnarchive={() => unarchive(selectedMessage)}
            onStar={() => toggleStar(selectedMessage)}
            onToggleRead={() => toggleRead(selectedMessage)}
            onTags={() => setTagsFor(selectedMessage)}
            onDelete={() => remove(selectedMessage)}
            onAddTask={() => void onCreateTask(taskDraftFromMail(selectedMessage, t))}
            onAddTaskAI={() => void createTaskAI(selectedMessage)}
            aiBusy={aiBusyId === selectedMessage.id}
          />
        ) : (
          <div className="mail-read-empty">
            <div className="mail-read-empty-art" aria-hidden="true">
              <span className="mail-art-card back" />
              <span className="mail-art-card front">
                <span className="mail-art-avatar" />
                <span className="mail-art-lines"><span /><span /><span /></span>
                <span className="mail-art-dot" />
              </span>
            </div>
            <h2 className="mail-read-empty-title">{t("mail.view.emptyReader.title")}</h2>
            <p className="mail-read-empty-body">{t("mail.view.emptyReader.body")}</p>
            {unreadLoaded > 0 && <p className="mail-read-empty-meta"><span className="mail-unread-dot" aria-hidden="true" />{tp("mail.view.unreadCount", unreadLoaded)}</p>}
          </div>
        )}
      </div>

      {mailMenu.menu && <ContextMenu x={mailMenu.menu.x} y={mailMenu.menu.y} items={mailMenu.menu.items} onClose={mailMenu.closeMenu} />}

      {tagsFor && (
        <TagsDialog
          message={tagsFor}
          labels={customLabels}
          onToggle={toggleTag}
          onClose={() => setTagsFor(null)}
        />
      )}

      {connectOpen && !account && <ConnectDialog onClose={() => setConnectOpen(false)} />}

      {toast && <div className="mail-toast" role="status">{toast}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Sub-components                                                            */
/* ------------------------------------------------------------------------ */

function MailListSkeleton({ label }: { readonly label: string }) {
  return (
    <div className="mail-skeleton" role="listitem">
      <span className="mail-sr" role="status">{label}</span>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="mail-skeleton-row" aria-hidden="true">
          <span className="mail-skeleton-avatar" />
          <span className="mail-skeleton-lines">
            <span style={{ width: `${38 + ((i * 17) % 30)}%` }} />
            <span style={{ width: `${62 + ((i * 11) % 28)}%` }} />
            <span style={{ width: `${48 + ((i * 23) % 40)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

type MailRowProps = {
  readonly message: MailMessage;
  readonly labels: MailLabel[];
  readonly isSelected: boolean;
  readonly isChecked: boolean;
  readonly selectMode: boolean;
  readonly lang: string;
  readonly starLabel: string;
  readonly unreadLabel: string;
  readonly attachmentLabel: string;
  readonly onSelect: () => void;
  readonly onToggleStar: () => void;
  readonly onContextMenu: (e: React.MouseEvent) => void;
  readonly longPress: Record<string, unknown>;
  readonly aiBusy: boolean;
  readonly aiBusyLabel: string;
};

function MailRow({ message: m, labels, isSelected, isChecked, selectMode, lang, starLabel, unreadLabel, attachmentLabel, onSelect, onToggleStar, onContextMenu, longPress, aiBusy, aiBusyLabel }: MailRowProps) {
  return (
    <div
      role="listitem"
      aria-busy={aiBusy}
      className={`mail-row${m.unread ? " unread" : ""}${isSelected ? " selected" : ""}${isChecked ? " checked" : ""}${m.starred ? " starred" : ""}`}
      onContextMenu={onContextMenu}
      {...(longPress as object)}
    >
      <button
        type="button"
        className="mail-row-hit"
        onClick={onSelect}
        aria-current={!selectMode && isSelected ? "true" : undefined}
        aria-pressed={selectMode ? isChecked : undefined}
      >
        {selectMode ? (
          <span className={`mail-checkbox${isChecked ? " on" : ""}`} aria-hidden="true">{isChecked && <Icon name="check" />}</span>
        ) : (
          <span className="mail-avatar" style={{ background: avatarColor(m.from.email) }} aria-hidden="true">{initials(m.from.name)}</span>
        )}
        <span className="mail-row-main">
          <span className="mail-row-top">
            <span className="mail-from">{m.from.name}</span>
            {m.unread && <span className="mail-unread-dot"><span className="mail-sr">{unreadLabel}</span></span>}
            <time className="mail-date" dateTime={m.date}>{formatMailDate(m.date, lang)}</time>
          </span>
          <span className="mail-subject-line">
            <span className="mail-subject">{m.subject}</span>
            {m.hasAttachment && <span className="mail-attach-flag" title={attachmentLabel}><PaperclipGlyph /><span className="mail-sr">{attachmentLabel}</span></span>}
          </span>
          <span className="mail-snippet">{m.snippet}</span>
          {labels.length > 0 && (
            <span className="mail-chips">
              {labels.map((l) => <LabelChip key={l.id} label={l} />)}
            </span>
          )}
        </span>
      </button>
      {aiBusy && <span className="mail-row-ai-loading" role="status" aria-label={aiBusyLabel}><AgentIdentity size="tiny" thinking /></span>}
      <button
        type="button"
        className={`mail-star${m.starred ? " on" : ""}`}
        title={starLabel}
        aria-label={starLabel}
        aria-pressed={m.starred}
        onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
      >
        <Icon name="star" />
      </button>
    </div>
  );
}

function taskDraftFromMail(m: MailMessage, t: (k: string) => string): TaskDraft {
  const description = [m.snippet, "", `${m.from.name} <${m.from.email}>`].join("\n").trim();
  return {
    title: m.subject === "(no subject)" ? t("mail.title") : m.subject,
    description,
    important: false,
    urgent: false,
    status: "inbox",
    priority: 4,
  };
}

type MailReaderProps = {
  readonly message: MailMessage;
  readonly labelById: Map<string, MailLabel>;
  readonly canTag: boolean;
  readonly onBack: () => void;
  readonly onArchive: () => void;
  readonly onUnarchive: () => void;
  readonly onStar: () => void;
  readonly onToggleRead: () => void;
  readonly onTags: () => void;
  readonly onDelete: () => void;
  readonly onAddTask: () => void;
  readonly onAddTaskAI: () => void;
  readonly aiBusy: boolean;
};

function MailReader({ message: m, labelById, canTag, onBack, onArchive, onUnarchive, onStar, onToggleRead, onTags, onDelete, onAddTask, onAddTaskAI, aiBusy }: MailReaderProps) {
  const { t, lang } = useI18n();
  const subjectId = useId();
  const cardId = useId();
  const shownLabels = m.labelIds.map((id) => labelById.get(id)).filter((l): l is MailLabel => Boolean(l && !l.system));
  const toList = m.to.map((a) => a.name || a.email).join(", ");
  const paragraphs = m.body.split(/\n{2,}/);
  const inInbox = m.labelIds.includes("INBOX") && !m.archived;
  // Rich HTML rendering (sanitized): links open outside the app so a click
  // can never navigate the Prior webview away.
  const safeHtml = useMemo(() => (m.bodyHtml ? sanitizeMailHtml(m.bodyHtml) : ""), [m.bodyHtml]);
  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href || href.startsWith("#")) { e.preventDefault(); return; }
    e.preventDefault();
    void (async () => {
      try {
        if (isTauri()) await openExternalUrl(href);
        else window.open(href, "_blank", "noopener,noreferrer");
      } catch {
        // Popup blocked or opener unavailable: stay on the mail.
      }
    })();
  }, []);
  const starLabel = m.starred ? t("mail.actions.unstar") : t("mail.actions.star");
  const readLabel = m.unread ? t("mail.actions.markRead") : t("mail.actions.markUnread");
  return (
    <article className="mail-reader" aria-labelledby={subjectId}>
      <div className="mail-reader-toolbar" role="toolbar" aria-label={m.subject}>
        <button type="button" className="mail-tool mail-back" title={t("mail.actions.back")} aria-label={t("mail.actions.back")} onClick={onBack}><Icon name="chevron-left" /></button>
        {inInbox ? (
          <button type="button" className="mail-tool" title={t("mail.actions.archive")} aria-label={t("mail.actions.archive")} onClick={onArchive}><Icon name="archive" /></button>
        ) : (
          <button type="button" className="mail-tool" title={t("mail.actions.unarchive")} aria-label={t("mail.actions.unarchive")} onClick={onUnarchive}><Icon name="inbox" /></button>
        )}
        <button type="button" className="mail-tool danger" title={t("mail.actions.delete")} aria-label={t("mail.actions.delete")} onClick={onDelete}><Icon name="trash" /></button>
        <button type="button" className={`mail-tool${m.starred ? " starred" : ""}`} title={starLabel} aria-label={starLabel} aria-pressed={m.starred} onClick={onStar}><Icon name="star" /></button>
        {canTag && <button type="button" className="mail-tool" title={t("mail.actions.manageTags")} aria-label={t("mail.actions.manageTags")} onClick={onTags}><Icon name="tag" /></button>}
        <button type="button" className="mail-tool" title={readLabel} aria-label={readLabel} onClick={onToggleRead}><Icon name={m.unread ? "eye" : "mail"} /></button>
        <span className="mail-reader-spacer" />
        <button type="button" className="mail-btn mail-btn-accent" onClick={onAddTask} aria-label={t("mail.view.createTask")}>
          <Icon name="plus" /><span className="mail-btn-label">{t("mail.view.createTask")}</span>
        </button>
      </div>

      <div className="mail-reader-content">
        <header className="mail-reader-header">
          <h2 className="mail-reader-subject" id={subjectId}>{m.subject}</h2>
          {shownLabels.length > 0 && (
            <div className="mail-chips reader">
              {shownLabels.map((l) => <LabelChip key={l.id} label={l} />)}
            </div>
          )}
          <div className="mail-reader-meta">
            <span className="mail-avatar large" style={{ background: avatarColor(m.from.email) }} aria-hidden="true">{initials(m.from.name)}</span>
            <div className="mail-reader-sender">
              <div className="mail-reader-from-line">
                <span className="mail-reader-from">{m.from.name}</span>
                <span className="mail-reader-email">&lt;{m.from.email}&gt;</span>
              </div>
              <span className="mail-reader-to">
                {toList && <>{t("mail.reading.to", { list: toList })} · </>}
                <time dateTime={m.date}>{formatReaderDate(m.date, lang)}</time>
              </span>
            </div>
          </div>
        </header>

        <section className={`mail-agent-card${aiBusy ? " busy" : ""}`} aria-labelledby={cardId}>
          <AgentIdentity size="small" thinking={aiBusy} />
          <div className="mail-agent-card-text">
            <h3 className="mail-agent-card-title" id={cardId}>{t("mail.view.taskCard.title")}</h3>
            <p className="mail-agent-card-body">{t("mail.view.taskCard.body")}</p>
          </div>
          <button type="button" className="mail-btn mail-btn-primary" disabled={aiBusy} aria-busy={aiBusy} onClick={onAddTaskAI}>
            <Icon name="sparkles" />
            <span>{aiBusy ? t("mail.view.taskCard.drafting") : t("mail.view.taskCard.action")}</span>
          </button>
        </section>

        <div className="mail-reader-body">
          {safeHtml ? (
            <div className="mail-reader-html" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: safeHtml }} />
          ) : (
            paragraphs.map((para, i) => {
              const lines = para.split("\n");
              return <p key={i}>{lines.map((line, j) => <span key={j}>{line}{j < lines.length - 1 ? <br /> : null}</span>)}</p>;
            })
          )}
        </div>
        {m.hasAttachment && (
          <div className="mail-reader-attachments">
            <span className="mail-attachment-chip"><PaperclipGlyph /><span>{t("mail.view.attachments")}</span></span>
          </div>
        )}
      </div>
    </article>
  );
}

/** Gmail connection pitch, shared by the disconnected page and the dialog. */
function ConnectContent({ headingLevel = "h3" }: { readonly headingLevel?: "h1" | "h3" }) {
  const { t } = useI18n();
  const Heading = headingLevel;
  return (
    <div className="mail-connect-content">
      <div className="mail-connect-pair" aria-hidden="true">
        <span className="mail-connect-badge"><Icon name="google" /></span>
        <span className="mail-connect-link"><span /><span /><span /></span>
        <AgentIdentity size="small" />
      </div>
      <Heading className="mail-connect-title">{t("mail.connect.title")}</Heading>
      <p className="mail-connect-body">{t("mail.connect.body")}</p>
      <div className="mail-connect-perms">
        <p className="mail-connect-perms-title">{t("mail.connect.permissionTitle")}</p>
        <ul>
          <li><Icon name="check" /><span>{t("mail.connect.permissionRead")}</span></li>
          <li><Icon name="check" /><span>{t("mail.connect.permissionLabels")}</span></li>
        </ul>
      </div>
      <button type="button" className="mail-connect-cta" onClick={() => startGmailConnect()}>
        <Icon name="google" /><span>{t("mail.connect.button")}</span>
      </button>
      <p className="mail-connect-secure"><Icon name="lock" /><span>{t("mail.connect.secure")}</span></p>
    </div>
  );
}

function ConnectDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  return (
    <dialog ref={ref} className="mail-connect-dialog" aria-label={t("mail.connect.title")} onCancel={onClose}>
      <div className="mail-connect-card">
        <button type="button" className="mail-connect-close" aria-label={t("common.actions.close")} onClick={onClose}><Icon name="close" /></button>
        <ConnectContent />
      </div>
    </dialog>
  );
}

/** Tag picker for a single conversation. Mounted only while open so
 * useModalDialog's showModal() effect runs with the dialog in the DOM. */
function TagsDialog({
  message,
  labels,
  onToggle,
  onClose,
}: {
  readonly message: MailMessage;
  readonly labels: MailLabel[];
  readonly onToggle: (labelId: string) => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  return (
    <dialog ref={ref} className="mail-tags-dialog" aria-label={t("mail.tags.title")} onCancel={onClose}>
      <div className="mail-tags-card">
        <div className="mail-tags-head">
          <h3>{t("mail.tags.title")}</h3>
          <button type="button" className="mail-tool" aria-label={t("common.actions.close")} onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="mail-tags-list">
          {labels.length === 0 && <p className="mail-tags-empty">{t("mail.tags.empty")}</p>}
          {labels.map((label) => {
            const has = message.labelIds.includes(label.id);
            return (
              <button key={label.id} type="button" className={`mail-tag-row${has ? " on" : ""}`} aria-pressed={has} onClick={() => onToggle(label.id)}>
                <span className="mail-label-dot" style={{ background: label.color ?? "var(--faint)" }} aria-hidden="true" />
                <span className="mail-tag-name">{label.name}</span>
                {has && <Icon name="check" />}
              </button>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}
