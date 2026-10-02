// Shown above sign-in when the visitor arrived from a project invite link:
// who invited them, to what, and what joining means.
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import type { InvitePreview } from "../../../lib/gamification/state";
import { pendingLink } from "../../../lib/pendingLink";
import { WorkspaceIcon } from "../../WorkspaceIcon";
import "./InvitePreviewCard.css";

export function InvitePreviewCard() {
  const { t } = useI18n();
  const [preview, setPreview] = useState<InvitePreview | null>(null);

  useEffect(() => {
    const token = pendingLink()?.invite;
    if (!token) return undefined;
    let cancelled = false;
    // A wrong or offline preview simply shows nothing: sign-in still works.
    api.getInvitePreview(token).then((value) => { if (!cancelled) setPreview(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!preview) return null;
  const members = preview.memberCount === 1 ? t("onboarding.invite.memberOne") : t("onboarding.invite.members", { count: preview.memberCount });
  return (
    <section className="invite-preview" aria-live="polite">
      <span className="invite-preview-icon" aria-hidden="true"><WorkspaceIcon icon={preview.projectIcon} fallback="folder" /></span>
      <div className="invite-preview-text">
        <strong>{t("onboarding.invite.title", { name: preview.inviterName, project: preview.projectName })}</strong>
        {preview.status === "pending" && <span>{members} · {preview.role === "viewer" ? t("onboarding.invite.roleViewer") : t("onboarding.invite.roleEditor")}</span>}
        {preview.status === "pending" && <span>{t("onboarding.invite.signIn")} {t("onboarding.invite.confirm")}</span>}
        {preview.status === "expired" && <span className="invite-preview-warning">{t("onboarding.invite.expired", { name: preview.inviterName })}</span>}
        {preview.status === "revoked" && <span className="invite-preview-warning">{t("onboarding.invite.revoked", { name: preview.inviterName })}</span>}
        {preview.status === "accepted" && <span className="invite-preview-warning">{t("onboarding.invite.accepted")}</span>}
      </div>
      {preview.inviterAvatarUrl && <img className="invite-preview-avatar" src={preview.inviterAvatarUrl} alt="" referrerPolicy="no-referrer" />}
    </section>
  );
}
