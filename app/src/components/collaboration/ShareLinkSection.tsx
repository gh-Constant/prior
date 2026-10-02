import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { CustomSelect } from "../CustomSelect";
import { copyText } from "../../lib/clipboard";
import { useI18n } from "../../lib/i18n";
import { pruneShareLinks, rememberShareLink, rememberedShareLink } from "../../lib/shareLinkCache";
import type { ProjectInvite, ShareLinkActions, ShareLinkItem } from "./types";

type Role = ProjectInvite["role"];
const ROLES: readonly Role[] = ["editor", "viewer"];

type RowState = { busy?: boolean; error?: string; copied?: boolean; confirm?: "regenerate" | "disable" };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Whole days left, or null when the link never expires. 0 means expired. */
function daysLeft(link: ShareLinkItem): number | null {
  if (!link.expiresAt) return null;
  const ms = Date.parse(link.expiresAt) - Date.now();
  return Number.isFinite(ms) ? (ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)) : null;
}

type Props = {
  readonly actions: ShareLinkActions;
  /** Read-only while the project is loading or Prior is offline. */
  readonly disabled?: boolean;
};

/**
 * The "Invitation link" block of the share dialog: one reusable link per role.
 * Opening a link never grants access by itself; the visitor confirms first.
 */
export function ShareLinkSection({ actions, disabled = false }: Props) {
  const { t, tp } = useI18n();
  const [links, setLinks] = useState<ShareLinkItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState(0);
  const [rows, setRows] = useState<Partial<Record<Role, RowState>>>({});
  const timers = useRef<number[]>([]);
  // Refs keep `load` stable: translators and action objects change identity on every render.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const failedTextRef = useRef("");
  failedTextRef.current = t("collab.shareLink.loadFailed");

  const patch = (role: Role, next: RowState) => setRows((current) => ({ ...current, [role]: next }));

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const list = await actionsRef.current.list();
      pruneShareLinks(list.map((link) => link.id));
      setUrls(Object.fromEntries(list.flatMap((link) => { const url = rememberedShareLink(link.id); return url ? [[link.id, url]] : []; })));
      setLinks(list);
    } catch (error) {
      setLoadError(errorMessage(error, failedTextRef.current));
      setLinks((current) => current ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  async function create(role: Role) {
    patch(role, { busy: true });
    try {
      const { link, url } = await actions.create(role, expiry || undefined);
      rememberShareLink(link.id, url);
      setUrls((current) => ({ ...current, [link.id]: url }));
      setLinks((current) => [...(current ?? []).filter((item) => item.role !== role), link]);
      patch(role, {});
      // Hand the new link to the clipboard right away: that is why people create it.
      try {
        await copyText(url);
        patch(role, { copied: true });
        timers.current.push(window.setTimeout(() => patch(role, {}), 2200));
      } catch {
        // Copy is one tap away on the row.
      }
    } catch (error) {
      patch(role, { error: errorMessage(error, t("collab.shareLink.createFailed")) });
    }
  }

  async function disable(role: Role, link: ShareLinkItem) {
    patch(role, { busy: true });
    try {
      await actions.revoke(link.id);
      setLinks((current) => (current ?? []).filter((item) => item.id !== link.id));
      patch(role, {});
    } catch (error) {
      patch(role, { error: errorMessage(error, t("collab.shareLink.revokeFailed")) });
    }
  }

  async function copy(role: Role, url: string) {
    try {
      await copyText(url);
      patch(role, { copied: true });
      timers.current.push(window.setTimeout(() => patch(role, {}), 2200));
    } catch {
      patch(role, { error: t("collab.share.copyFailed") });
    }
  }

  const expiryOptions = [
    { value: 0, label: t("collab.shareLink.expiryNever") },
    { value: 7, label: t("collab.shareLink.expiry7") },
    { value: 30, label: t("collab.shareLink.expiry30") },
  ];

  return <section className="collab-sharelinks" aria-label={t("collab.shareLink.title")}>
    <div className="collab-sharelinks-head">
      <h3>{t("collab.shareLink.title")}</h3>
      <div className="collab-sharelinks-expiry"><span className="collab-muted">{t("collab.shareLink.expiryLabel")}</span>
        <CustomSelect ariaLabel={t("collab.shareLink.expiryLabel")} value={expiry} disabled={disabled} onChange={(value) => setExpiry(Number(value))} options={expiryOptions} />
      </div>
    </div>
    <p className="collab-muted collab-sharelinks-hint">{t("collab.shareLink.hint")}</p>
    {loadError && <p className="collab-error" role="alert">{loadError} <button type="button" className="collab-linkish" onClick={() => void load()}>{t("collab.shareLink.retry")}</button></p>}
    {links === null ? <p className="collab-muted" role="status"><Icon name="refresh" className="collab-spin" /> {t("collab.shareLink.loading")}</p> :
      <ul className="collab-members collab-sharelink-list">{ROLES.map((role) => {
        const link = links.find((item) => item.role === role);
        const state = rows[role] ?? {};
        const url = link ? urls[link.id] : undefined;
        const days = link ? daysLeft(link) : null;
        const expired = days === 0;
        const roleName = t(`collab.shareLink.${role}`);
        return <li key={role} className="collab-sharelink" aria-busy={state.busy}>
          <span className="collab-avatar collab-avatar-pending" aria-hidden="true"><Icon name="link" /></span>
          <div className="collab-person-copy">
            <strong>{roleName}</strong>
            <small>{t(role === "editor" ? "collab.shareLink.editorHint" : "collab.shareLink.viewerHint")}</small>
            {link && <small className={expired ? "collab-error" : undefined}>
              {link.useCount ? tp("collab.shareLink.uses", link.useCount) : t("collab.shareLink.unused")} · {expired ? t("collab.shareLink.expired") : days === null ? t("collab.shareLink.neverExpires") : tp("collab.shareLink.expiresIn", days)}
            </small>}
            {state.error && <small className="collab-error" role="alert">{state.error}</small>}
          </div>
          {!link ? <button type="button" className="secondary-button" disabled={disabled || state.busy} onClick={() => void create(role)}>
            {state.busy ? <Icon name="refresh" className="collab-spin" /> : <Icon name="plus" />}{t("collab.shareLink.create")}
          </button> : <span className="collab-invite-actions">
            {state.confirm ? <span className="collab-confirm">
              <button type="button" className="secondary-button" onClick={() => patch(role, {})}>{t("collab.share.cancel")}</button>
              <button type="button" className="danger-button" disabled={state.busy} onClick={() => void (state.confirm === "disable" ? disable(role, link) : create(role))}>
                {state.confirm === "disable" ? t("collab.shareLink.disable") : t("collab.shareLink.regenerate")}
              </button>
            </span> : <>
              <button type="button" className="secondary-button" disabled={disabled || state.busy} onClick={() => patch(role, { confirm: "regenerate" })} aria-label={t("collab.shareLink.regenerateFor", { role: roleName })}>{t("collab.shareLink.regenerate")}</button>
              <button type="button" className="secondary-button" disabled={disabled || state.busy} onClick={() => patch(role, { confirm: "disable" })} aria-label={t("collab.shareLink.disableFor", { role: roleName })}>{t("collab.shareLink.disable")}</button>
            </>}
          </span>}
          {state.confirm && link && <p className="collab-sharelink-wide collab-muted" role="status">{t(state.confirm === "disable" ? "collab.shareLink.disableConfirm" : "collab.shareLink.regenerateConfirm")}</p>}
          {link && !state.confirm && (url ? <div className="collab-link-row collab-sharelink-wide">
            <input readOnly value={url} aria-label={t("collab.shareLink.linkFor", { role: roleName })} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="secondary-button" disabled={disabled} onClick={() => void copy(role, url)}><Icon name={state.copied ? "check" : "link"} />{state.copied ? t("collab.share.copied") : t("collab.shareLink.copy")}</button>
          </div> : <p className="collab-sharelink-wide collab-muted"><Icon name="lock" aria-hidden="true" /> {t("collab.shareLink.hidden")}</p>)}
        </li>;
      })}</ul>}
  </section>;
}
