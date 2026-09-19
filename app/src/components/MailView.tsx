import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MailLabel, MailMessage, TaskDraft } from "../types";
import { useI18n } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";
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

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 62% 45%)`;
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

function labelColor(label: MailLabel | undefined): { bg: string; fg: string } {
  if (label?.color) return { bg: label.color, fg: label.textColor ?? "#ffffff" };
  return { bg: "var(--later)", fg: "var(--ink)" };
}
export function MailView({ user, onCreateTask, onCreateTaskAI }: MailViewProps) {
  const { t, tp, lang } = useI18n();
  const mailMenu = useContextMenu();

  const [provider, setProvider] = useState<MailProvider | null>(null);
  const [providerKind, setProviderKind] = useState<"gmail" | "demo">("demo");
  const [labels, setLabels] = useState<MailLabel[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [folder, setFolder] = useState("inbox");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tagsFor, setTagsFor] = useState<MailMessage | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "read">("list");
  const [account, setAccount] = useState(getMailAccount());
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
      account: account?.email ?? "demo",
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
     account for this Prior session, else the local demo mailbox. The local
     record just seeds the "connected as" display until the server confirms. */
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
            }
            return;
          }
        } catch {
          // API unreachable or unauthorized: fall back to demo below.
        }
      }
      if (!cancelled) {
        const mod = await import("../lib/mail");
        // In demo mode the server has no Gmail account for this session, so
        // never surface a stale local record as "connected": the inbox must
        // keep offering Connect Gmail.
        setAccount(null);
        setProvider(new mod.DemoProvider(local?.email ?? "you@example.com"));
        setProviderKind("demo");
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, accountNonce]);

  useEffect(() => {
    const onAccountChange = () => {
      setConnectOpen(false);
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
    if (selectedId === m.id) setSelectedId(null);
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

  const bulkArchive = useCallback(() => {
    const targets = messages.filter((m) => checkedIds.has(m.id));
    for (const m of targets) void applyModify(m, [], ["INBOX"]);
    setCheckedIds(new Set());
    setSelectMode(false);
    showToast(t("mail.toasts.archived"));
  }, [messages, checkedIds, applyModify, showToast, t]);

  const bulkDelete = useCallback(() => {
    const targets = messages.filter((m) => checkedIds.has(m.id));
    for (const m of targets) void applyModify(m, ["TRASH"], ["INBOX"]);
    setCheckedIds(new Set());
    setSelectMode(false);
    showToast(t("mail.toasts.deleted"));
  }, [messages, checkedIds, applyModify, showToast, t]);

  const bulkMarkRead = useCallback(() => {
    const targets = messages.filter((m) => checkedIds.has(m.id));
    for (const m of targets) void applyModify(m, [], ["UNREAD"]);
    setCheckedIds(new Set());
    setSelectMode(false);
  }, [messages, checkedIds, applyModify]);

  const buildMenuItems = useCallback((m: MailMessage): ContextMenuItem[] => {
    return [
      { label: t("mail.menu.addToTask"), icon: "plus", run: () => void onCreateTask(taskDraftFromMail(m, t)) },
      { label: t("mail.menu.addToTaskAI"), icon: "sparkles", run: () => void onCreateTaskAI(m) },
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
  }, [t, onCreateTask, onCreateTaskAI, archive, unarchive, toggleStar, toggleRead, remove]);

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

  /* ---------------- Render ---------------- */

  const showConnectCard = providerKind === "demo" && !account;

  return (
    <section className="mail-view" aria-label={t("mail.title")}>
      <aside className="mail-rail">
        <button type="button" className="mail-connect-button" onClick={() => (account ? undefined : setConnectOpen(true))}>
          <Icon name="google" />
          <span>{account ? t("mail.connect.connectedAs", { email: account.email }) : t("mail.connect.title")}</span>
        </button>
        <nav className="mail-folders" aria-label={t("mail.title")}>
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`mail-folder ${folder === f.id && !activeLabel ? "active" : ""}`}
              onClick={() => { setFolder(f.id); setActiveLabel(null); }}
            >
              <Icon name={f.icon} />
              <span>{t(`mail.folders.${f.id}`)}</span>
            </button>
          ))}
        </nav>
        {customLabels.length > 0 && (
          <div className="mail-labels-block">
            <p className="mail-labels-title">{t("mail.labels")}</p>
            {customLabels.map((label) => (
              <button
                key={label.id}
                type="button"
                className={`mail-label ${activeLabel === label.id ? "active" : ""}`}
                onClick={() => setActiveLabel(activeLabel === label.id ? null : label.id)}
              >
                <span className="mail-label-dot" style={{ background: label.color ?? "var(--muted)" }} />
                <span>{label.name}</span>
              </button>
            ))}
          </div>
        )}
        {account && providerKind === "gmail" && (
          <button type="button" className="mail-disconnect" onClick={disconnect}>{t("mail.actions.disconnect")}</button>
        )}
      </aside>

      <div className={`mail-list-pane ${mobilePane === "read" ? "mobile-hidden" : ""}`}>
        <div className="mail-toolbar">
          <div className="mail-search">
            <Icon name="search" />
            <input
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
          </div>
          <button type="button" className={`mail-icon-btn ${refreshing ? "spinning" : ""}`} title={t("mail.actions.refresh")} aria-label={t("mail.actions.refresh")} onClick={() => void refresh()}>
            <Icon name="refresh" />
          </button>
          <button
            type="button"
            className={`mail-icon-btn ${selectMode ? "active" : ""}`}
            title={t("mail.actions.select")}
            aria-label={t("mail.actions.select")}
            onClick={() => { setSelectMode((v) => !v); setCheckedIds(new Set()); }}
          >
            <Icon name="check-circle" />
          </button>
        </div>

        {selectMode && checkedIds.size > 0 && (
          <div className="mail-bulkbar">
            <span>{checkedIds.size}</span>
            <button type="button" className="mail-icon-btn" title={t("mail.actions.archive")} aria-label={t("mail.actions.archive")} onClick={bulkArchive}><Icon name="archive" /></button>
            <button type="button" className="mail-icon-btn" title={t("mail.actions.markRead")} aria-label={t("mail.actions.markRead")} onClick={bulkMarkRead}><Icon name="eye" /></button>
            <button type="button" className="mail-icon-btn danger" title={t("mail.actions.delete")} aria-label={t("mail.actions.delete")} onClick={bulkDelete}><Icon name="trash" /></button>
          </div>
        )}

        {showConnectCard && (
          <button type="button" className="mail-demo-banner" onClick={() => setConnectOpen(true)}>
            <Icon name="sparkles" />
            <span><strong>{t("mail.connect.demoBanner")}</strong> — {t("mail.connect.demoHint")}</span>
          </button>
        )}

        <div className="mail-list" role="list">
          {loading && messages.length === 0 && (
            <div className="mail-loading" aria-live="polite"><span className="mail-spinner" />{t("common.actions.loading")}</div>
          )}
          {!loading && messages.length === 0 && (
            <div className="mail-empty">
              <Icon name="inbox" />
              <p>{debouncedQuery ? t("mail.empty.search", { query: debouncedQuery }) : t("mail.empty.inbox")}</p>
            </div>
          )}
          {messages.map((m) => (
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
            />
          ))}
          {nextPageToken && !loading && (
            <button type="button" className="mail-load-more" onClick={() => void load(false, nextPageToken)}>
              {t("mail.actions.loadMore")}
            </button>
          )}
        </div>
      </div>

      <div className={`mail-read-pane ${mobilePane === "list" ? "mobile-hidden" : ""}`}>
        {selectedMessage ? (
          <MailReader
            message={selectedMessage}
            labelById={labelById}
            onBack={() => setMobilePane("list")}
            onArchive={() => archive(selectedMessage)}
            onStar={() => toggleStar(selectedMessage)}
            onDelete={() => remove(selectedMessage)}
            onAddTask={() => void onCreateTask(taskDraftFromMail(selectedMessage, t))}
            onAddTaskAI={() => void onCreateTaskAI(selectedMessage)}
          />
        ) : (
          <div className="mail-read-empty">
            <Icon name="mail" />
            <p>{t("mail.reading.noSelection")}</p>
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

      {connectOpen && !account && <ConnectCard onClose={() => setConnectOpen(false)} />}

      {toast && <div className="mail-toast" role="status">{toast}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Sub-components                                                            */
/* ------------------------------------------------------------------------ */

type MailRowProps = {
  readonly message: MailMessage;
  readonly labels: MailLabel[];
  readonly isSelected: boolean;
  readonly isChecked: boolean;
  readonly selectMode: boolean;
  readonly lang: string;
  readonly starLabel: string;
  readonly onSelect: () => void;
  readonly onToggleStar: () => void;
  readonly onContextMenu: (e: React.MouseEvent) => void;
  readonly longPress: Record<string, unknown>;
};

function MailRow({ message: m, labels, isSelected, isChecked, selectMode, lang, starLabel, onSelect, onToggleStar, onContextMenu, longPress }: MailRowProps) {
  return (
    <div
      role="listitem"
      className={`mail-row ${m.unread ? "unread" : ""} ${isSelected ? "selected" : ""} ${isChecked ? "checked" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      {...(longPress as object)}
    >
      {selectMode ? (
        <span className={`mail-checkbox ${isChecked ? "on" : ""}`} aria-hidden="true">{isChecked && <Icon name="check" />}</span>
      ) : (
        <span className="mail-avatar" style={{ background: avatarColor(m.from.email) }} aria-hidden="true">{initials(m.from.name)}</span>
      )}
      <div className="mail-row-main">
        <div className="mail-row-top">
          <span className="mail-from">{m.from.name}</span>
          <span className="mail-date">{formatMailDate(m.date, lang)}</span>
        </div>
        <div className="mail-subject-line">
          <span className="mail-subject">{m.subject}</span>
          {m.hasAttachment && <Icon name="clipboard" />}
        </div>
        <div className="mail-snippet-line"><span className="mail-snippet">{m.snippet}</span></div>
        {labels.length > 0 && (
          <div className="mail-tags">
            {labels.map((l) => {
              const c = labelColor(l);
              return <span key={l.id} className="mail-tag" style={{ background: c.bg, color: c.fg }}>{l.name}</span>;
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        className={`mail-star ${m.starred ? "on" : ""}`}
        title={starLabel}
        aria-label={starLabel}
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
  readonly onBack: () => void;
  readonly onArchive: () => void;
  readonly onStar: () => void;
  readonly onDelete: () => void;
  readonly onAddTask: () => void;
  readonly onAddTaskAI: () => void;
};

function MailReader({ message: m, labelById, onBack, onArchive, onStar, onDelete, onAddTask, onAddTaskAI }: MailReaderProps) {
  const { t, tp, lang } = useI18n();
  const shownLabels = m.labelIds.map((id) => labelById.get(id)).filter((l): l is MailLabel => Boolean(l && !l.system));
  const toList = m.to.map((a) => a.name || a.email).join(", ");
  const paragraphs = m.body.split(/\n{2,}/);
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
  return (
    <article className="mail-reader">
      <div className="mail-reader-toolbar">
        <button type="button" className="mail-icon-btn mail-back" title={t("mail.actions.back")} aria-label={t("mail.actions.back")} onClick={onBack}><Icon name="chevron-left" /></button>
        <button type="button" className="mail-icon-btn" title={t("mail.actions.archive")} aria-label={t("mail.actions.archive")} onClick={onArchive}><Icon name="archive" /></button>
        <button type="button" className={`mail-icon-btn ${m.starred ? "starred" : ""}`} title={t("mail.actions.star")} aria-label={t("mail.actions.star")} onClick={onStar}><Icon name="star" /></button>
        <button type="button" className="mail-icon-btn danger" title={t("mail.actions.delete")} aria-label={t("mail.actions.delete")} onClick={onDelete}><Icon name="trash" /></button>
        <span className="mail-reader-spacer" />
        <button type="button" className="mail-task-btn" onClick={onAddTask}><Icon name="plus" /><span>{t("mail.actions.addToTask")}</span></button>
        <button type="button" className="mail-task-btn ai" onClick={onAddTaskAI}><Icon name="sparkles" /><span>{t("mail.actions.addToTaskAI")}</span></button>
      </div>
      <header className="mail-reader-header">
        <h2 className="mail-reader-subject">{m.subject}</h2>
        {shownLabels.length > 0 && (
          <div className="mail-tags reader">
            {shownLabels.map((l) => {
              const c = labelColor(l);
              return <span key={l.id} className="mail-tag" style={{ background: c.bg, color: c.fg }}>{l.name}</span>;
            })}
          </div>
        )}
        <div className="mail-reader-meta">
          <span className="mail-avatar large" style={{ background: avatarColor(m.from.email) }} aria-hidden="true">{initials(m.from.name)}</span>
          <div className="mail-reader-sender">
            <div className="mail-reader-from-line">
              <span className="mail-reader-from">{m.from.name}</span>
              <span className="mail-reader-email">&lt;{m.from.email}&gt;</span>
            </div>
            <span className="mail-reader-to">{t("mail.reading.to", { list: toList })}</span>
          </div>
          <time className="mail-reader-date" dateTime={m.date}>{formatMailDate(m.date, lang)}</time>
        </div>
      </header>
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
          <Icon name="clipboard" />
          <span>{tp("mail.reading.attachments", 1)}</span>
        </div>
      )}
    </article>
  );
}

function ConnectCard({ onClose }: { readonly onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  return (
    <dialog ref={ref} className="mail-connect-dialog" aria-label={t("mail.connect.title")}>
      <div className="mail-connect-card">
        <button type="button" className="mail-connect-close" aria-label={t("common.actions.close")} onClick={onClose}><Icon name="close" /></button>
        <div className="mail-connect-badge"><Icon name="google" /></div>
        <h3>{t("mail.connect.title")}</h3>
        <p className="mail-connect-body">{t("mail.connect.body")}</p>
        <div className="mail-connect-perms">
          <p className="mail-connect-perms-title">{t("mail.connect.permissionTitle")}</p>
          <div className="mail-connect-perm"><Icon name="check" /><span>{t("mail.connect.permissionRead")}</span></div>
          <div className="mail-connect-perm"><Icon name="check" /><span>{t("mail.connect.permissionLabels")}</span></div>
        </div>
        <button type="button" className="mail-connect-cta" onClick={() => startGmailConnect()}>
          <Icon name="google" /><span>{t("mail.connect.button")}</span>
        </button>
        <p className="mail-connect-secure">{t("mail.connect.secure")}</p>
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
          <button type="button" className="mail-icon-btn" aria-label={t("common.actions.close")} onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="mail-tags-list">
          {labels.length === 0 && <p className="mail-tags-empty">{t("mail.tags.empty")}</p>}
          {labels.map((label) => {
            const has = message.labelIds.includes(label.id);
            return (
              <button key={label.id} type="button" className={`mail-tag-row ${has ? "on" : ""}`} onClick={() => onToggle(label.id)}>
                <span className="mail-label-dot" style={{ background: label.color ?? "var(--muted)" }} />
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