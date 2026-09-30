import { useState } from "react";
import { api, isRateLimitedError } from "../../lib/api";
import { getToken, type SessionUser } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import "./Account.css";

const DISMISS_KEY = "prior.verify-banner.dismissed";

/** Password accounts only: Google already verified its accounts. */
export function needsEmailVerification(user: SessionUser | null): boolean {
  return Boolean(user && user.hasPassword && user.emailVerified === false);
}

function dismissedFor(userId: string): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === userId; } catch { return false; }
}

/** A discreet reminder to confirm the email, with a resend action. */
export function VerifyEmailBanner({ user }: { readonly user: SessionUser | null }) {
  const { t, lang } = useI18n();
  const [dismissed, setDismissed] = useState(() => (user ? dismissedFor(user.id) : false));
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  if (!user || !needsEmailVerification(user) || dismissed) return null;

  async function resend() {
    setStatus("sending");
    try {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      await api.resendVerification(lang, token);
      setStatus("sent");
    } catch (error) {
      // A recent email already went out: say so rather than failing.
      setStatus(isRateLimitedError(error) ? "sent" : "failed");
    }
  }

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, user!.id); } catch { /* storage unavailable */ }
    setDismissed(true);
  }

  return (
    <div className="verify-email-banner" role="region" aria-label={t("account.banner.label")}>
      <Icon name="mail" />
      <p aria-live="polite">
        {status === "sent" ? t("account.banner.sent", { email: user.email }) : status === "failed" ? t("account.banner.failed") : t("account.banner.text")}
      </p>
      {status !== "sent" && (
        <button type="button" className="link-button" disabled={status === "sending"} onClick={() => void resend()}>
          {status === "sending" ? t("account.banner.sending") : t("account.banner.resend")}
        </button>
      )}
      <button type="button" className="icon-button" aria-label={t("account.banner.dismiss")} onClick={dismiss}><Icon name="close" /></button>
    </div>
  );
}
