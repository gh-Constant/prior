import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";

type Props = {
  readonly email: string | null;
  readonly error: string | null;
  readonly onOpenCalendar: () => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
};

export function CalendarConnectionSuccess({ email, error, onOpenCalendar, onRetry, onClose }: Props) {
  const { t } = useI18n();
  const failed = Boolean(error);
  return (
    <main className="calendar-connection-page" aria-live="polite">
      <section className="calendar-connection-card" aria-labelledby="calendar-connection-title">
        <div className={`calendar-connection-icon ${failed ? "error" : "success"}`} aria-hidden="true"><Icon name={failed ? "close" : "check-circle"} /></div>
        <p className="calendar-connection-eyebrow">Prior · Google Calendar</p>
        <h1 id="calendar-connection-title">{t(failed ? "common.calendar.connection.errorTitle" : "common.calendar.connection.successTitle")}</h1>
        <p>{failed ? t("common.calendar.connection.errorDescription") : t("common.calendar.connection.successDescription", { email: email ?? "" })}</p>
        <div className="calendar-connection-actions">
          {failed ? <button type="button" className="primary-button" onClick={onRetry}>{t("common.actions.retry")}</button> : <button type="button" className="primary-button" onClick={onOpenCalendar}>{t("common.calendar.connection.openCalendar")}</button>}
          <button type="button" className="secondary-button" onClick={onClose}>{t("common.actions.dismiss")}</button>
        </div>
      </section>
    </main>
  );
}
