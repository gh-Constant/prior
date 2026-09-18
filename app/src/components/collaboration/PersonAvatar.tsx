import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { Person, PersonPresence } from "./types";

function presenceLabel(presence: PersonPresence, t: (key: string) => string): string {
  switch (presence) {
    case "online":
      return t("collab.presence.online");
    case "away":
      return t("collab.presence.away");
    case "offline":
    case "inactive":
      return t("collab.presence.inactive");
  }
}

export function PersonAvatar({
  person,
  className = "collab-avatar",
  showPresence = true,
}: {
  person: Person;
  className?: string;
  showPresence?: boolean;
}) {
  const { t } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = person.avatarUrl;
  const presence: PersonPresence | undefined =
    person.presence ??
    (person.status === "online" || person.status === "away" || person.status === "offline" || person.status === "inactive"
      ? (person.status as PersonPresence)
      : undefined);

  const title = presence ? `${person.name} (${presenceLabel(presence, t)})` : person.name;

  return (
    <span className={className} title={title} aria-label={title}>
      {url && url !== failedUrl ? (
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      ) : (
        person.name.trim().slice(0, 1).toUpperCase() || "?"
      )}
      {showPresence && presence && (
        <span
          className={`collab-presence-dot presence-${presence}`}
          title={presenceLabel(presence, t)}
          aria-label={presenceLabel(presence, t)}
        />
      )}
    </span>
  );
}
