// Asks before joining a project from an invitation link: an email invitation
// or an editor/viewer share link. Nothing is joined until "Join" is pressed,
// including for people who signed up through the link (the dialog waits for
// the onboarding and the tour to finish: see App's `ready`).
import { useEffect, useRef, useState } from "react";
import { ApiCodeError, ApiRequestError, PlanLimitError, type JoinResult } from "../../lib/api";
import type { InvitePreview } from "../../lib/gamification/state";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { WorkspaceIcon } from "../WorkspaceIcon";
import "./Collaboration.css";

type InvalidReason = "expired" | "revoked" | "accepted" | "exhausted" | "notFound" | "full" | "mismatch";

/** Why a join attempt failed, in terms of what the person should be told. */
export function joinFailure(error: unknown): { reason: InvalidReason } | { retry: true } | { message: string } {
  if (error instanceof ApiCodeError) {
    if (error.code === "LINK_REVOKED") return { reason: "revoked" };
    if (error.code === "LINK_EXPIRED") return { reason: "expired" };
    if (error.code === "LINK_EXHAUSTED") return { reason: "exhausted" };
    if (error.code === "INVITE_NOT_FOUND") return { reason: "notFound" };
  }
  if (error instanceof PlanLimitError) return { reason: "full" };
  if (error instanceof ApiRequestError && (error.kind === "network" || error.kind === "timeout" || error.kind === "rate_limited")) return { retry: true };
  if (error instanceof Error && /does not match/i.test(error.message)) return { reason: "mismatch" };
  return { message: error instanceof Error ? error.message : "" };
}

/**
 * When the confirmation may appear. Someone who signed up through the link
 * first goes through the onboarding and the tour; the dialog comes after.
 */
export function canPromptToJoin(state: {
  readonly signedIn: boolean;
  readonly onboardingOpen: boolean;
  readonly tourOpen: boolean;
  /** The account's onboarding status is loaded (or cannot be). */
  readonly onboardingKnown: boolean;
  /** The account still has an onboarding to run, which is about to open. */
  readonly onboardingPending: boolean;
}): boolean {
  return state.signedIn && !state.onboardingOpen && !state.tourOpen && state.onboardingKnown && !state.onboardingPending;
}

const RANK = { owner: 3, editor: 2, viewer: 1 } as const;

/** True when the person already has at least the role the invitation offers. */
export function alreadyCovered(preview: InvitePreview): boolean {
  return Boolean(preview.alreadyMember && preview.currentRole && RANK[preview.currentRole] >= RANK[preview.role]);
}

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "retry" }
  | { readonly kind: "confirm"; readonly preview: InvitePreview }
  | { readonly kind: "invalid"; readonly reason: InvalidReason; readonly name?: string };

export type JoinInviteDialogProps = {
  readonly token: string;
  /** False until the onboarding (and tour) are over: nothing is fetched or shown. */
  readonly ready: boolean;
  readonly loadPreview: (token: string) => Promise<InvitePreview>;
  readonly onJoin: (token: string) => Promise<JoinResult>;
  readonly onJoined: (result: JoinResult, preview: InvitePreview) => void;
  /** The person already has the offered role: nothing to confirm. */
  readonly onAlreadyMember: (preview: InvitePreview) => void;
  /** The link can never work (expired, disabled…): forget it. */
  readonly onInvalid: () => void;
  /** Decide later: the link stays pending and is offered again next launch. */
  readonly onLater: () => void;
  /** Dismiss for good. */
  readonly onDecline: () => void;
};

export function JoinInviteDialog(props: JoinInviteDialogProps) {
  const { token, ready } = props;
  const { t, tp } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setPhase({ kind: "loading" });
    setError("");
    callbacks.current.loadPreview(token).then((preview) => {
      if (cancelled) return;
      if (preview.status !== "pending") {
        callbacks.current.onInvalid();
        setPhase({ kind: "invalid", reason: preview.status === "revoked" ? "revoked" : preview.status === "accepted" ? "accepted" : "expired", name: preview.inviterName });
      } else if (alreadyCovered(preview)) {
        callbacks.current.onAlreadyMember(preview);
      } else {
        setPhase({ kind: "confirm", preview });
      }
    }).catch((failure: unknown) => {
      if (cancelled) return;
      const offline = failure instanceof ApiRequestError && failure.kind !== "rate_limited";
      if (offline) { setPhase({ kind: "retry" }); return; }
      callbacks.current.onInvalid();
      setPhase({ kind: "invalid", reason: "notFound" });
    });
    return () => { cancelled = true; };
  }, [token, ready, attempt]);

  if (!ready) return null;

  async function join(preview: InvitePreview) {
    setJoining(true);
    setError("");
    try {
      const result = await callbacks.current.onJoin(token);
      callbacks.current.onJoined(result, preview);
    } catch (failure) {
      const outcome = joinFailure(failure);
      if ("reason" in outcome) {
        callbacks.current.onInvalid();
        setPhase({ kind: "invalid", reason: outcome.reason, name: preview.inviterName });
      } else {
        setError("retry" in outcome ? t("collab.join.offline") : outcome.message || t("collab.join.failed"));
      }
    } finally {
      setJoining(false);
    }
  }

  // Usually instant: no spinner modal, the dialog appears once the invitation is known.
  if (phase.kind === "loading") return null;

  if (phase.kind === "retry") {
    return <Modal title={t("collab.join.pendingTitle")} onClose={props.onLater} maxWidth={460}>
      <div className="collab-join">
        <p className="collab-join-body" role="alert">{t("collab.join.offline")}</p>
        <div className="collab-join-actions">
          <button type="button" className="primary-button" onClick={() => setAttempt((value) => value + 1)}><Icon name="refresh" />{t("collab.join.retry")}</button>
          <span className="collab-join-secondary"><button type="button" className="secondary-button" onClick={props.onLater}>{t("collab.join.later")}</button></span>
        </div>
      </div>
    </Modal>;
  }

  if (phase.kind === "invalid") {
    return <Modal title={t("collab.join.invalidTitle")} onClose={props.onDecline} maxWidth={460}>
      <div className="collab-join">
        <p className="collab-join-body" role="alert">{t(`collab.join.invalid.${phase.reason}`, { name: phase.name ?? t("collab.join.theOwner") })}</p>
        <div className="collab-join-actions">
          <span />
          <button type="button" className="primary-button" onClick={props.onDecline} autoFocus>{t("collab.join.understood")}</button>
        </div>
      </div>
    </Modal>;
  }

  const { preview } = phase;
  const upgrade = Boolean(preview.alreadyMember);
  const roleName = t(`collab.join.role.${preview.role}`);
  return <Modal title={upgrade ? t("collab.join.upgradeTitle", { project: preview.projectName, role: roleName }) : t("collab.join.title", { project: preview.projectName })} onClose={props.onLater} maxWidth={460}>
    <div className="collab-join">
      <div className="collab-join-summary">
        <span className="collab-join-icon" aria-hidden="true"><WorkspaceIcon icon={preview.projectIcon} fallback="folder" /></span>
        <div className="collab-join-text">
          <strong>{preview.projectName}</strong>
          <span>{t("collab.join.invitedBy", { name: preview.inviterName })}{" · "}{preview.memberCount === 1 ? t("collab.join.memberOne") : tp("collab.join.members", preview.memberCount)}</span>
        </div>
      </div>
      <p className="collab-join-body">{t(upgrade ? "collab.join.bodyUpgrade" : preview.role === "viewer" ? "collab.join.bodyViewer" : "collab.join.bodyEditor", { name: preview.inviterName })}</p>
      {error && <p className="collab-error" role="alert">{error}</p>}
      <div className="collab-join-actions">
        <button type="button" className="primary-button" disabled={joining} aria-busy={joining} onClick={() => void join(preview)} autoFocus>
          {joining ? <><Icon name="refresh" className="collab-spin" />{t("collab.join.joining")}</> : <><Icon name="check" />{upgrade ? t("collab.join.upgrade", { role: roleName }) : t("collab.join.join")}</>}
        </button>
        <span className="collab-join-secondary">
          <button type="button" className="secondary-button" disabled={joining} onClick={props.onLater}>{t("collab.join.later")}</button>
          <button type="button" className="secondary-button" disabled={joining} onClick={props.onDecline}>{t("collab.join.decline")}</button>
        </span>
      </div>
    </div>
  </Modal>;
}
