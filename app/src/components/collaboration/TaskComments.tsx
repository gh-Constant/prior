import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, type TaskComment } from "../../lib/api";
import { getToken, getUser } from "../../lib/auth";
import { collaborationStore } from "../../lib/collaborationStore";
import { commentParts, extractMentions, filterMentionables, insertMention, mentionQuery, relativeTime, type Mentionable } from "../../lib/comments";
import { useI18n } from "../../lib/i18n";
import { REALTIME_EVENT } from "../../lib/realtime";
import { generateUuid } from "../../lib/uuid";
import { PersonAvatar } from "./PersonAvatar";
import "../account/Account.css";
import "./TaskComments.css";

type Props = {
  readonly projectId: string;
  readonly taskId: string;
  readonly currentUserId: string | null;
  readonly role: "owner" | "editor" | "viewer" | undefined;
  readonly members: readonly Mentionable[];
};

function CommentBody({ comment, members }: { readonly comment: TaskComment; readonly members: readonly Mentionable[] }) {
  const mentioned = members.filter((member) => comment.mentions.includes(member.userId));
  return (
    <p className="task-comment-body">
      {commentParts(comment.body, mentioned).map((part, index) => {
        if (part.kind === "link") return <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow">{part.value}</a>;
        if (part.kind === "mention") return <span key={index} className="task-comment-mention">{part.value}</span>;
        return <span key={index}>{part.value}</span>;
      })}
    </p>
  );
}

/** A textarea with @mention autocomplete (ARIA combobox + listbox). */
function CommentEditor({ value, onChange, onSubmit, onCancel, members, currentUserId, label, submitLabel, busy, autoFocus = false }: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel?: () => void;
  readonly members: readonly Mentionable[];
  readonly currentUserId: string | null;
  readonly label: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = mentionQuery(value, caret);
  const suggestions = query && !dismissed ? filterMentionables(members, query.query, currentUserId ?? undefined) : [];
  const open = suggestions.length > 0;

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => { setActive(0); }, [query?.query]);

  function choose(member: Mentionable) {
    if (!query) return;
    const next = insertMention(value, query.start, caret, member);
    onChange(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => ref.current?.setSelectionRange(next.caret, next.caret));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % suggestions.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index - 1 + suggestions.length) % suggestions.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(suggestions[active]); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit(); return; }
    if (event.key === "Escape" && onCancel) { event.preventDefault(); event.stopPropagation(); onCancel(); }
  }

  return (
    <div className="task-comment-editor">
      <textarea
        ref={ref}
        value={value}
        rows={2}
        maxLength={4000}
        placeholder={t("comments.placeholder")}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        disabled={busy}
      />
      {open && (
        <ul id={listId} role="listbox" className="task-comment-mentions" aria-label={t("comments.mentionList")}>
          {suggestions.map((member, index) => (
            <li
              key={member.userId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "active" : ""}
              onMouseDown={(event) => { event.preventDefault(); choose(member); }}
            >
              <PersonAvatar person={{ id: member.userId, name: member.displayName, avatarUrl: member.avatarUrl }} showPresence={false} />
              <span>{member.displayName}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="task-comment-editor-actions">
        <span className="task-comment-hint">{t("comments.hint")}</span>
        {onCancel && <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>{t("comments.cancel")}</button>}
        <button type="button" className="primary-button" onClick={onSubmit} disabled={busy || !value.trim()}>{submitLabel}</button>
      </div>
    </div>
  );
}

/** Comment thread of a shared-project task, live over /v1/realtime. */
export function TaskComments({ projectId, taskId, currentUserId, role, members }: Props) {
  const { t, lang } = useI18n();
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canWrite = role === "owner" || role === "editor";
  const live = useRef(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const result = await api.listTaskComments(projectId, taskId, token);
      if (live.current) setComments(result.comments);
    } catch {
      if (live.current) setComments((current) => current ?? []);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    live.current = true;
    setComments(null);
    void load();
    const onRealtime = (event: Event) => {
      if ((event as CustomEvent<{ type?: string }>).detail?.type === "comments_required") void load();
    };
    window.addEventListener(REALTIME_EVENT, onRealtime);
    return () => { live.current = false; window.removeEventListener(REALTIME_EVENT, onRealtime); };
  }, [load]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members]);

  async function run(action: (token: string) => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      await action(token);
    } catch {
      setError(t("comments.failed"));
    } finally {
      setBusy(false);
    }
  }

  const post = () => run(async (token) => {
    const body = draft.trim();
    if (!body) return;
    const created = await api.createTaskComment(projectId, taskId, { id: generateUuid(), body, mentions: extractMentions(body, members) }, token);
    setComments((current) => [...(current ?? []).filter((comment) => comment.id !== created.id), created]);
    setDraft("");
  });

  const saveEdit = () => run(async (token) => {
    if (!editing) return;
    const body = editing.body.trim();
    const updated = await api.updateTaskComment(projectId, taskId, editing.id, { body, mentions: extractMentions(body, members) }, token);
    setComments((current) => (current ?? []).map((comment) => (comment.id === updated.id ? updated : comment)));
    setEditing(null);
  });

  const remove = (comment: TaskComment) => run(async (token) => {
    await api.deleteTaskComment(projectId, taskId, comment.id, token);
    setComments((current) => (current ?? []).filter((item) => item.id !== comment.id));
  });

  return (
    <section className="task-comments" aria-labelledby={`task-comments-${taskId}`}>
      <h3 id={`task-comments-${taskId}`}>{t("comments.title")}{comments && comments.length > 0 ? <span className="task-comments-count">{comments.length}</span> : null}</h3>
      {comments === null ? <p className="task-comments-empty" role="status">{t("comments.loading")}</p> : comments.length === 0 ? <p className="task-comments-empty">{t("comments.empty")}</p> : (
        <ol className="task-comment-list">
          {comments.map((comment) => {
            const mine = Boolean(comment.author && comment.author.id === currentUserId);
            const name = comment.author ? comment.author.displayName || memberById.get(comment.author.id)?.displayName || t("comments.someone") : t("comments.deletedUser");
            return (
              <li key={comment.id} className="task-comment">
                <PersonAvatar person={{ id: comment.author?.id ?? "deleted", name, avatarUrl: comment.author?.avatarUrl }} showPresence={false} />
                <div className="task-comment-main">
                  <div className="task-comment-meta">
                    <strong className={comment.author ? "" : "deleted"}>{name}</strong>
                    <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString(lang)}>{relativeTime(comment.createdAt, lang)}</time>
                    {comment.editedAt && <span className="task-comment-edited" title={new Date(comment.editedAt).toLocaleString(lang)}>{t("comments.edited")}</span>}
                  </div>
                  {editing?.id === comment.id ? (
                    <CommentEditor value={editing.body} onChange={(body) => setEditing({ id: comment.id, body })} onSubmit={() => void saveEdit()} onCancel={() => setEditing(null)} members={members} currentUserId={currentUserId} label={t("comments.editLabel")} submitLabel={t("comments.save")} busy={busy} autoFocus />
                  ) : <CommentBody comment={comment} members={members} />}
                  {editing?.id !== comment.id && ((mine && canWrite) || role === "owner") && (
                    <div className="task-comment-actions">
                      {mine && canWrite && <button type="button" className="link-button" onClick={() => setEditing({ id: comment.id, body: comment.body })}>{t("comments.edit")}</button>}
                      <button type="button" className="link-button danger" onClick={() => void remove(comment)} aria-label={t("comments.deleteLabel", { name })}>{t("comments.delete")}</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {canWrite
        ? <CommentEditor value={draft} onChange={setDraft} onSubmit={() => void post()} members={members} currentUserId={currentUserId} label={t("comments.newLabel")} submitLabel={t("comments.post")} busy={busy} />
        : <p className="task-comments-empty">{t("comments.readOnly")}</p>}
    </section>
  );
}

/** The comment thread for a task, shown only when its project is shared. */
export function SharedTaskComments({ task }: { readonly task: { id: string; projectId?: string | null } }) {
  const [, rerender] = useState(0);
  useEffect(() => collaborationStore.subscribe(() => rerender((value) => value + 1)), []);
  const projectId = task.projectId;
  if (!projectId || !collaborationStore.isShared(projectId)) return null;
  const members: Mentionable[] = collaborationStore.members(projectId).map((member) => ({ userId: member.userId, displayName: member.displayName, avatarUrl: member.avatarUrl }));
  return <TaskComments projectId={projectId} taskId={task.id} currentUserId={getUser()?.id ?? null} role={collaborationStore.role(projectId)} members={members} />;
}
