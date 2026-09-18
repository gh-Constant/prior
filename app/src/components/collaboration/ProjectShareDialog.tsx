import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import type { ProjectInvite, ProjectSharingProps } from "./types";
import "./Collaboration.css";

export function ProjectShareDialog({ projectName, onClose, members, invites, canManage = false, loading = false, busy = false, error, notice, onInvite, onRoleChange, onRevokeInvite, onCopyLink }: ProjectSharingProps & { projectName: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectInvite["role"]>("editor");
  const bodyRef = useRef<HTMLDivElement>(null);
  const editable = canManage && !loading && !busy;
  const duplicate = [...members.map((member) => member.email), ...invites.map((invite) => invite.email)].some((value) => value?.toLowerCase() === email.trim().toLowerCase());

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

  return <div onKeyDown={trapFocus}><Modal title={`Share ${projectName}`} onClose={onClose} maxWidth={560}>
    <div className="collab-share-body" ref={bodyRef}>
      <p className="collab-notice"><Icon name="lock" aria-hidden="true" />Only invited members can access this project. A link does not grant access.</p>
      {!canManage && <ReadOnlyNotice />}
      {error && <p className="collab-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? <CollaborationState title="Loading project members…" loading /> : <>
        <section aria-label="Project members"><h3>Members <span className="collab-muted">{members.length}</span></h3>
          {members.length ? <ul className="collab-members">{members.map((member) => <li key={member.id}>
            <span className="collab-avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>
            <div className="collab-person-copy"><strong>{member.name}</strong>{member.email && <small>{member.email}</small>}</div>
            {member.role === "owner" ? <span className="collab-chip">Owner</span> : <select aria-label={`Project role for ${member.name}`} value={member.role} disabled={!editable || !onRoleChange} onChange={(event) => onRoleChange?.(member.id, event.target.value as ProjectInvite["role"])}><option value="editor">Editor</option><option value="viewer">Viewer</option></select>}
          </li>)}</ul> : <p className="collab-muted">No members to display.</p>}
        </section>
        <section aria-label="Pending invitations"><h3>Pending invites <span className="collab-muted">{invites.length}</span></h3>
          {invites.length ? <ul className="collab-members">{invites.map((invite) => <li key={invite.id}>
            <div className="collab-person-copy"><strong>{invite.email}</strong><small>{invite.role === "editor" ? "Editor" : "Viewer"} · Pending</small></div>
            {canManage && <button type="button" className="secondary-button" disabled={!editable || !onRevokeInvite} onClick={() => onRevokeInvite?.(invite.id)} aria-label={`Revoke invite for ${invite.email}`}>Revoke</button>}
          </li>)}</ul> : <p className="collab-muted">No pending invitations.</p>}
        </section>
      </>}
      {canManage && <form className="collab-invite-form" onSubmit={(event) => { event.preventDefault(); if (editable && email.trim() && !duplicate) onInvite?.(email.trim(), role); }}>
        <label className="collab-field"><span>Email address</span><input type="email" required value={email} disabled={!editable || !onInvite} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
        <label className="collab-field"><span>Invite role</span><select value={role} disabled={!editable || !onInvite} onChange={(event) => setRole(event.target.value as ProjectInvite["role"])}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label>
        <button type="submit" className="primary-button" disabled={!editable || !onInvite || !email.trim() || duplicate}><Icon name="mail" />{busy ? "Working…" : "Invite"}</button>
        {duplicate && <p className="collab-muted" role="status">This person is already a member or has a pending invitation.</p>}
      </form>}
      <div className="collab-share-footer"><button type="button" className="secondary-button" disabled={!onCopyLink || loading || busy} onClick={onCopyLink}><Icon name="link" />Copy project link</button><button type="button" className="secondary-button" onClick={onClose}>Done</button></div>
    </div>
  </Modal></div>;
}
