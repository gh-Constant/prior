import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import "./Collaboration.css";

export function CollaborationState({ title, description, loading = false }: { title: string; description?: string; loading?: boolean }) {
  return <div className="collab-empty" role="status" aria-busy={loading}>
    <Icon name={loading ? "refresh" : "inbox"} aria-hidden="true" />
    <strong>{title}</strong>
    {description && <p>{description}</p>}
  </div>;
}

export function ReadOnlyNotice() {
  const { t } = useI18n();
  return <p className="collab-notice"><Icon name="lock" aria-hidden="true" />{t("collab.readonly.notice")}</p>;
}
