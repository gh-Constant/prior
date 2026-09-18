import { Icon } from "../Icon";
import "./Collaboration.css";

export function CollaborationState({ title, description, loading = false }: { title: string; description?: string; loading?: boolean }) {
  return <div className="collab-empty" role="status" aria-busy={loading}>
    <Icon name={loading ? "refresh" : "inbox"} aria-hidden="true" />
    <strong>{title}</strong>
    {description && <p>{description}</p>}
  </div>;
}

export function ReadOnlyNotice() {
  return <p className="collab-notice"><Icon name="lock" aria-hidden="true" />You have view-only access. Ask a project owner to make changes.</p>;
}
