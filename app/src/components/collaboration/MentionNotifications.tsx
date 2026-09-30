import { useState } from "react";
import type { MentionNotification } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import "./Collaboration.css";
import "./TaskComments.css";

type Props = {
  readonly mentions: readonly MentionNotification[];
  readonly onOpen: (mention: MentionNotification) => Promise<void>;
  readonly onRead: (commentIds: string[]) => Promise<void>;
};

/** Unread @mentions, shown like project invites: open or mark as read. */
export function MentionNotifications({ mentions, onOpen, onRead }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const unread = mentions.filter((mention) => !mention.readAt);
  if (!unread.length) return null;
  const shown = unread.slice(0, 3);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }

  return (
    <section className="collab-invite-toasts mention-toasts" aria-label={t("comments.mentions.label", { count: unread.length })} aria-live="polite">
      {shown.map((mention) => (
        <article key={mention.commentId} className="collab-invite-toast">
          <Icon name="bell" aria-hidden="true" />
          <div>
            <p>{t("comments.mentions.title", { name: mention.authorName || t("comments.deletedUser"), task: mention.taskTitle, project: mention.projectName })}</p>
            <p className="mention-excerpt">{mention.excerpt}</p>
          </div>
          <div className="collab-invite-toast-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => onRead([mention.commentId]))}>{t("comments.mentions.markRead")}</button>
            <button type="button" className="primary-button" disabled={busy} onClick={() => void act(() => onOpen(mention))}>{t("comments.mentions.open")}</button>
          </div>
        </article>
      ))}
      {unread.length > 1 && (
        <button type="button" className="secondary-button mention-read-all" disabled={busy} onClick={() => void act(() => onRead([]))}>
          {t("comments.mentions.markAllRead", { count: unread.length })}
        </button>
      )}
    </section>
  );
}
