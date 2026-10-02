import "./PresenceDot.css";
import { useI18n } from "../../lib/i18n";
import { presenceLabelKey, type PersonPresence } from "../../lib/presence";

/** "5 minutes ago" in the app language, or "" when the date is unusable. */
export function relativeSince(iso: string, lang: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["day", 86_400], ["hour", 3_600], ["minute", 60]];
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
  }
  return format.format(0, "minute");
}

/** The sentence for a state, with "last seen" for an offline person when known. */
export function usePresenceLabel(presence: PersonPresence, lastSeenAt?: string | null): string {
  const { t, lang } = useI18n();
  const status = t(presenceLabelKey(presence));
  if (presence !== "offline" || !lastSeenAt) return status;
  const when = relativeSince(lastSeenAt, lang);
  return when ? t("collab.presence.lastSeen", { status, when }) : status;
}

/**
 * The one presence indicator of the app: green = online, orange = away,
 * grey ring = offline. Placed inside an avatar it sits on the bottom-right
 * corner; the state is never conveyed by color alone (the label and the ring
 * shape carry it too).
 */
export function PresenceDot({ presence, lastSeenAt, className = "" }: { presence: PersonPresence; lastSeenAt?: string | null; className?: string }) {
  const label = usePresenceLabel(presence, lastSeenAt);
  return <span className={`presence-dot is-${presence}${className ? ` ${className}` : ""}`} role="img" aria-label={label} title={label} data-presence={presence} />;
}
