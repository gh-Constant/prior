import { useState } from "react";
import { PresenceDot, usePresenceLabel } from "./PresenceDot";
import type { Person } from "./types";

export function PersonAvatar({
  person,
  className = "collab-avatar",
  showPresence = true,
}: {
  person: Person;
  className?: string;
  showPresence?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = person.avatarUrl;
  const presence = showPresence ? person.presence : undefined;
  const presenceLabel = usePresenceLabel(presence ?? "offline", person.lastSeenAt);
  const title = presence ? `${person.name} (${presenceLabel})` : person.name;

  return (
    <span className={className} title={title} aria-label={title}>
      {url && url !== failedUrl ? (
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      ) : (
        person.name.trim().slice(0, 1).toUpperCase() || "?"
      )}
      {presence && <PresenceDot presence={presence} lastSeenAt={person.lastSeenAt} />}
    </span>
  );
}
