import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { PersonAvatar } from "./PersonAvatar";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { useI18n } from "../../lib/i18n";
import { copyText } from "../../lib/clipboard";
import { CustomSelect } from "../CustomSelect";
import type { InviteOutcome, Person, ProjectInvite, ProjectMember, ProjectSharingProps } from "./types";
import "./Collaboration.css";

type Role = ProjectInvite["role"];

const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Splits "a@x.com, b@y.com; c@z.com" into distinct, trimmed addresses. */
export function parseInviteEmails(value: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of value.split(/[\s,;]+/)) {
    const email = raw.trim().replace(/^<|>$/g, "");
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (EMAIL_PATTERN.test(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
}

function daysLeft(expiresAt: string | undefined): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type RowState = { busy?: boolean; saved?: boolean; error?: string; confirming?: boolean };
type InviteRowState = RowState & { link?: string; copied?: boolean; resent?: boolean };

function useRowStates<T extends RowState>() {
  const [states, setStates] = useState<Record<string, T>>({});
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => { for (const timer of timers.current.values()) window.clearTimeout(timer); }, []);
  const patch = (id: string, next: Partial<T>) => setStates((current) => ({ ...current, [id]: { ...current[id], ...next } as T }));
  /** Shows a short-lived confirmation (✓ saved, copied…). */
  const flash = (id: string, next: Partial<T>, clear: Partial<T>) => {
    patch(id, next);
    const existing = timers.current.get(id);
    if (existing) window.clearTimeout(existing);
    timers.current.set(id, window.setTimeout(() => patch(id, clear), 2200));
  };
  return { states, patch, flash };
}

export function ProjectShareDialog({ projectName, onClose, members, invites, canManage = false, loading = false, currentUserId = null, suggestions = [], onInvite, onRoleChange, onRemoveMember, onLeave, onRevokeInvite, onResendInvite, projectLink, onCopyLink }: ProjectSharingProps & { projectName: string; onClose: () => void }) {
  const { t, tp } = useI18n();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [inviting, setInviting] = useState(false);
  const [outcomes, setOutcomes] = useState<InviteOutcome[]>([]);
  const [copiedOutcome, setCopiedOutcome] = useState<string | null>(null);
  const [projectCopied, setProjectCopied] = useState(false);
  const [leaveState, setLeaveState] = useState<RowState>({});
  const memberRows = useRowStates<RowState>();
  const inviteRows = useRowStates<InviteRowState>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editable = canManage && !loading;

  const known = useMemo(() => new Set([...members.map((member) => member.email?.toLowerCase()), ...invites.map((invite) => invite.email.toLowerCase())].filter(Boolean) as string[]), [members, invites]);
  const parsed = parseInviteEmails(emails);
  const fresh = parsed.valid.filter((email) => !known.has(email.toLowerCase()));
  const duplicates = parsed.valid.filter((email) => known.has(email.toLowerCase()));
  const canSubmit = editable && Boolean(onInvite) && !inviting && fresh.length > 0 && parsed.invalid.length === 0;
  const query = emails.split(/[\s,;]+/).pop()?.trim().toLowerCase() ?? "";
  const suggested = suggestions
    .filter((person) => person.email && !known.has(person.email.toLowerCase()) && !parsed.valid.some((email) => email.toLowerCase() === person.email?.toLowerCase()))
    .filter((person) => !query || person.name.toLowerCase().includes(query) || person.email!.toLowerCase().includes(query))
    .slice(0, 5);

  useEffect(() => { bodyRef.current?.closest<HTMLElement>("[role=dialog]")?.querySelector<HTMLElement>("button")?.focus(); }, []);

  // Modal provides dismissal/restoration; keep keyboard focus inside this dialog.
  function trapFocus(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const dialog = bodyRef.current?.closest<HTMLElement>("[role=dialog]");
    const elements = dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']");
    if (!elements?.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function invite() {
    if (!canSubmit || !onInvite) return;
    setInviting(true);
    setCopiedOutcome(null);
    const results: InviteOutcome[] = [];
    for (const email of fresh) {
      try {
        const outcome = await onInvite(email, role);
        if (outcome) results.push(outcome);
      } catch (error) {
        results.push({ kind: "error", email, message: errorMessage(error, t("collab.share.inviteFailed")) });
      }
    }
    setInviting(false);
    setOutcomes(results);
    // Keep only what failed in the field, ready to fix and retry.
    const failed = results.filter((outcome) => outcome.kind === "error").map((outcome) => outcome.email);
    if (results.length) setEmails(failed.join(", "));
    inputRef.current?.focus();
  }

  function addSuggestion(person: Person) {
    if (!person.email) return;
    const parts = emails.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length && query && !EMAIL_PATTERN.test(parts[parts.length - 1])) parts.pop();
    setEmails([...parts, person.email].join(", ") + ", ");
    inputRef.current?.focus();
  }

  async function copyOutcome(outcome: Extract<InviteOutcome, { kind: "invited" }>) {
    try {
      await copyText(outcome.link);
      setCopiedOutcome(outcome.email);
    } catch {
      setCopiedOutcome(null);
    }
  }

  async function changeRole(member: ProjectMember, next: Role) {
    if (!onRoleChange || next === member.role) return;
    memberRows.patch(member.id, { busy: true, error: undefined, saved: false });
    try {
      await onRoleChange(member.id, next);
      memberRows.patch(member.id, { busy: false });
      memberRows.flash(member.id, { saved: true }, { saved: false });
    } catch (error) {
      memberRows.patch(member.id, { busy: false, error: errorMessage(error, t("collab.share.roleFailed")) });
    }
  }

  async function removeMember(member: ProjectMember) {
    if (!onRemoveMember) return;
    memberRows.patch(member.id, { busy: true, error: undefined, confirming: false });
    try {
      await onRemoveMember(member.id);
      memberRows.patch(member.id, { busy: false });
    } catch (error) {
      memberRows.patch(member.id, { busy: false, error: errorMessage(error, t("collab.share.removeFailed")) });
    }
  }

  async function leave() {
    if (!onLeave) return;
    setLeaveState({ busy: true });
    try {
      await onLeave();
      setLeaveState({});
      onClose();
    } catch (error) {
      setLeaveState({ error: errorMessage(error, t("collab.share.leaveFailed")) });
    }
  }

  async function revoke(invite: ProjectInvite) {
    if (!onRevokeInvite) return;
    inviteRows.patch(invite.id, { busy: true, error: undefined });
    try {
      await onRevokeInvite(invite.id);
      inviteRows.patch(invite.id, { busy: false });
    } catch (error) {
      inviteRows.patch(invite.id, { busy: false, error: errorMessage(error, t("collab.share.revokeFailed")) });
    }
  }

  async function resend(invite: ProjectInvite) {
    if (!onResendInvite) return;
    inviteRows.patch(invite.id, { busy: true, error: undefined });
    try {
      const result = await onResendInvite(invite.id, true);
      inviteRows.patch(invite.id, { busy: false, link: result.link });
      inviteRows.flash(invite.id, { resent: true }, { resent: false });
      if (!result.emailSent) inviteRows.patch(invite.id, { error: t("collab.share.emailNotSent") });
    } catch (error) {
      inviteRows.patch(invite.id, { busy: false, error: errorMessage(error, t("collab.share.resendFailed")) });
    }
  }

  async function copyInviteLink(invite: ProjectInvite) {
    const known = inviteRows.states[invite.id]?.link;
    if (!known && !onResendInvite) return;
    inviteRows.patch(invite.id, { error: undefined });
    // Only a hash of each link is stored: an unknown link is re-issued
    // (without an email). The promise keeps the click valid for the clipboard.
    const link = known ? Promise.resolve(known) : onResendInvite!(invite.id, false).then((result) => {
      inviteRows.patch(invite.id, { link: result.link });
      return result.link;
    });
    try {
      await copyText(known ?? link);
      inviteRows.flash(invite.id, { copied: true }, { copied: false });
    } catch (error) {
      inviteRows.patch(invite.id, { error: errorMessage(error, t("collab.share.copyFailed")) });
    }
  }

  async function copyProjectLink() {
    try {
      if (projectLink) await copyText(projectLink);
      await onCopyLink?.();
      setProjectCopied(true);
      window.setTimeout(() => setProjectCopied(false), 2200);
    } catch {
      setProjectCopied(false);
    }
  }

  const roleOptions = [
    { value: "editor", label: t("collab.roles.editor") },
    { value: "viewer", label: t("collab.roles.viewer") },
  ];
  const self = members.find((member) => member.id === currentUserId);

  return <div onKeyDown={trapFocus}><Modal title={t("collab.share.title", { name: projectName })} onClose={onClose} maxWidth={580}>
    <div className="collab-share-body" ref={bodyRef}>
      {canManage ? <form className="collab-invite-form" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
        <label className="collab-field collab-invite-emails"><span>{t("collab.share.email")}</span>
          <input ref={inputRef} type="text" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={emails} disabled={!editable || !onInvite || inviting} onChange={(event) => { setEmails(event.target.value); setOutcomes([]); }} placeholder={t("collab.share.emailPlaceholder")} aria-describedby="collab-invite-hint" />
        </label>
        <div className="collab-field"><span>{t("collab.share.inviteRole")}</span><CustomSelect ariaLabel={t("collab.share.inviteRole")} value={role} disabled={!editable || !onInvite || inviting} onChange={(val) => setRole(val as Role)} options={roleOptions} /></div>
        <button type="submit" className="primary-button" disabled={!canSubmit} aria-busy={inviting}>{inviting ? <><Icon name="refresh" className="collab-spin" />{t("collab.share.inviting")}</> : <><Icon name="mail" />{t("collab.share.invite")}</>}</button>
        <p id="collab-invite-hint" className="collab-muted collab-invite-hint">
          {parsed.invalid.length ? <span className="collab-error">{t("collab.share.invalidEmail", { email: parsed.invalid[0] })}</span>
            : duplicates.length && !fresh.length ? t("collab.share.duplicate")
            : t(role === "editor" ? "collab.share.roleHintEditor" : "collab.share.roleHintViewer")}
        </p>
        {suggested.length > 0 && <div className="collab-suggestions" role="group" aria-label={t("collab.share.suggestions")}>
          <span className="collab-muted">{t("collab.share.suggestions")}</span>
          {suggested.map((person) => <button type="button" key={person.id} className="collab-chip-btn" disabled={!editable || inviting} onClick={() => addSuggestion(person)} title={person.email}>
            <PersonAvatar person={person} className="collab-avatar collab-avatar-xs" showPresence={false} />{person.name}
          </button>)}
        </div>}
      </form> : <ReadOnlyNotice />}

      {outcomes.length > 0 && <div className="collab-outcomes">
        {outcomes.map((outcome) => outcome.kind === "error"
          ? <p key={outcome.email} className="collab-outcome is-error" role="alert"><Icon name="important" /><span><strong>{outcome.email}</strong> — {outcome.message}</span></p>
          : outcome.kind === "member"
            ? <p key={outcome.email} className="collab-outcome is-success" role="status"><Icon name="check-circle" aria-hidden="true" /><span>{t("collab.share.roleChangedFor", { email: outcome.email, role: t(`collab.roles.${outcome.role}`) })}</span></p>
            : <div key={outcome.email} className="collab-outcome is-success" role="status">
              <Icon name="check-circle" aria-hidden="true" />
              <div className="collab-outcome-copy">
                <span><strong>{t("collab.share.invitedTitle", { email: outcome.email })}</strong></span>
                <small>{outcome.emailSent ? t("collab.share.invitedEmailed") : t("collab.share.invitedNoEmail")}</small>
                <div className="collab-link-row">
                  <input readOnly value={outcome.link} aria-label={t("collab.share.inviteLinkFor", { email: outcome.email })} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="secondary-button" onClick={() => void copyOutcome(outcome)}><Icon name={copiedOutcome === outcome.email ? "check" : "link"} />{copiedOutcome === outcome.email ? t("collab.share.copied") : t("collab.share.copyInviteLink")}</button>
                </div>
              </div>
            </div>)}
      </div>}

      {loading ? <CollaborationState title={t("collab.share.loading")} loading /> : <>
        <section aria-label={t("collab.share.membersGroup")}><h3>{t("collab.share.members")} <span className="collab-muted">{members.length}</span></h3>
          {members.length ? <ul className="collab-members">{members.map((member) => {
            const state = memberRows.states[member.id] ?? {};
            const isSelf = member.id === currentUserId;
            return <li key={member.id} aria-busy={state.busy}>
              <PersonAvatar person={member} />
              <div className="collab-person-copy"><strong>{member.name}{isSelf && <span className="collab-muted"> {t("collab.share.you")}</span>}</strong>{member.email && <small>{member.email}</small>}{state.error && <small className="collab-error" role="alert">{state.error}</small>}</div>
              {state.saved && <span className="collab-saved" role="status"><Icon name="check" />{t("collab.share.saved")}</span>}
              {state.busy && <span role="status" aria-label={t("collab.share.working")}><Icon name="refresh" className="collab-spin" /></span>}
              {member.role === "owner" ? <span className="collab-chip">{t("collab.roles.owner")}</span> : canManage ? <>
                <div className="collab-role-select-wrap">
                  <CustomSelect ariaLabel={t("collab.share.roleFor", { name: member.name })} value={member.role} disabled={!editable || !onRoleChange || state.busy} onChange={(val) => void changeRole(member, val as Role)} options={roleOptions} />
                </div>
                {state.confirming ? <span className="collab-confirm">
                  <button type="button" className="secondary-button" onClick={() => memberRows.patch(member.id, { confirming: false })}>{t("collab.share.cancel")}</button>
                  <button type="button" className="danger-button" disabled={state.busy} onClick={() => void removeMember(member)} aria-label={t("collab.share.confirmRemoveFor", { name: member.name })}>{t("collab.share.confirmRemove")}</button>
                </span> : <button type="button" className="secondary-button" disabled={!editable || !onRemoveMember || state.busy} onClick={() => memberRows.patch(member.id, { confirming: true })} aria-label={t("collab.share.removeFor", { name: member.name })}>{t("collab.share.remove")}</button>}
              </> : <span className="collab-chip">{t(`collab.roles.${member.role}`)}</span>}
            </li>;
          })}</ul> : <p className="collab-muted">{t("collab.share.noMembers")}</p>}
        </section>
        {(canManage || invites.length > 0) && <section aria-label={t("collab.share.invitesGroup")}><h3>{t("collab.share.invites")} <span className="collab-muted">{invites.length}</span></h3>
          {invites.length ? <ul className="collab-members">{invites.map((invite) => {
            const state = inviteRows.states[invite.id] ?? {};
            const days = daysLeft(invite.expiresAt);
            return <li key={invite.id} aria-busy={state.busy}>
              <span className="collab-avatar collab-avatar-pending" aria-hidden="true"><Icon name="mail" /></span>
              <div className="collab-person-copy"><strong>{invite.email}</strong><small>{invite.role === "editor" ? t("collab.roles.editor") : t("collab.roles.viewer")} · {t("collab.share.pending")}{days !== null && ` · ${tp("collab.share.expiresIn", days)}`}</small>{state.error && <small className="collab-error" role="alert">{state.error}</small>}</div>
              {state.resent && <span className="collab-saved" role="status"><Icon name="check" />{t("collab.share.resent")}</span>}
              {canManage && <span className="collab-invite-actions">
                {onResendInvite && <button type="button" className="secondary-button collab-icon-button" disabled={!editable || state.busy} onClick={() => void copyInviteLink(invite)} aria-label={t("collab.share.copyLinkFor", { email: invite.email })} title={t("collab.share.copyInviteLink")}><Icon name={state.copied ? "check" : "link"} /></button>}
                {onResendInvite && <button type="button" className="secondary-button" disabled={!editable || state.busy} onClick={() => void resend(invite)} aria-label={t("collab.share.resendFor", { email: invite.email })}>{t("collab.share.resend")}</button>}
                <button type="button" className="secondary-button" disabled={!editable || !onRevokeInvite || state.busy} onClick={() => void revoke(invite)} aria-label={t("collab.share.revokeFor", { email: invite.email })}>{t("collab.share.revoke")}</button>
              </span>}
            </li>;
          })}</ul> : <p className="collab-muted">{t("collab.share.noInvites")}</p>}
        </section>}
      </>}
      <p className="collab-notice"><Icon name="lock" aria-hidden="true" />{t("collab.share.notice")}</p>
      {leaveState.error && <p className="collab-error" role="alert">{leaveState.error}</p>}
      <div className="collab-share-footer">
        <div className="collab-share-footer-start">
          <button type="button" className="secondary-button" disabled={(!onCopyLink && !projectLink) || loading} onClick={() => void copyProjectLink()}><Icon name={projectCopied ? "check" : "link"} />{projectCopied ? t("collab.share.copied") : t("collab.share.copyLink")}</button>
          {self && self.role !== "owner" && onLeave && (leaveState.confirming
            ? <span className="collab-confirm"><button type="button" className="secondary-button" onClick={() => setLeaveState({})}>{t("collab.share.cancel")}</button><button type="button" className="danger-button" disabled={leaveState.busy} onClick={() => void leave()}>{t("collab.share.confirmLeave")}</button></span>
            : <button type="button" className="secondary-button" onClick={() => setLeaveState({ confirming: true })}><Icon name="logout" />{t("collab.share.leave")}</button>)}
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>{t("collab.share.done")}</button>
      </div>
    </div>
  </Modal></div>;
}
