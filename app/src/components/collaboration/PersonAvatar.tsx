import { useState } from "react";
import type { Person } from "./types";

export function PersonAvatar({ person, className = "collab-avatar" }: { person: Person; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = person.avatarUrl;
  return <span className={className} title={person.name} aria-hidden="true">
    {url && url !== failedUrl ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : person.name.trim().slice(0, 1).toUpperCase() || "?"}
  </span>;
}
