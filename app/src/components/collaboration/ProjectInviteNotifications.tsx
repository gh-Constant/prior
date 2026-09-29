import { useState } from "react";
import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import type { IncomingProjectInvite } from "../../lib/api";
import "./Collaboration.css";

type Props = {
  readonly invites: readonly IncomingProjectInvite[];
  readonly onRespond: (invite: IncomingProjectInvite, accept: boolean) => Promise<void>;
};

/** In-app notifications for project invites addressed to this account. */
export function ProjectInviteNotifications({ invites, onRespond }: Props) {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!invites.length) return null;

  async function respond(invite: IncomingProjectInvite, accept: boolean) {
    setBusyId(invite.id);
    try { await onRespond(invite, accept); } finally { setBusyId(null); }
  }

  return <section className="collab-invite-toasts" aria-label={t("collab.invites.label")} aria-live="polite">
    {invites.map((invite) => <article key={invite.id} className="collab-invite-toast">
      <Icon name="user" aria-hidden="true" />
      <p>{t("collab.invites.title", { name: invite.inviterName, project: invite.projectName })}</p>
      <div className="collab-invite-toast-actions">
        <button type="button" className="secondary-button" disabled={busyId !== null} onClick={() => void respond(invite, false)}>{t("collab.invites.decline")}</button>
        <button type="button" className="primary-button" disabled={busyId !== null} onClick={() => void respond(invite, true)}>{t("collab.invites.join")}</button>
      </div>
    </article>)}
  </section>;
}
