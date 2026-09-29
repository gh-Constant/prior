// Shared links (#invite=<token>, #project=<id>) must survive sign-in: the web
// Google flow navigates away and returns without the hash. The link target is
// moved into storage on arrival and consumed once the account has synced.

const STORAGE_KEY = "prior.pendingLink";
/** Invites expire server-side after a week; a stale capture is dropped earlier than never. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type PendingLink = { readonly invite?: string; readonly project?: string };

type Stored = PendingLink & { readonly capturedAt: number };

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (typeof stored.capturedAt !== "number" || Date.now() - stored.capturedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

/**
 * Moves #invite= / #project= from the address bar into storage and returns
 * what is pending. Call it once, as early as possible on startup.
 */
export function capturePendingLink(): PendingLink | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const invite = params.get("invite")?.trim() || undefined;
  const project = params.get("project")?.trim() || undefined;
  if (invite || project) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ invite, project, capturedAt: Date.now() } satisfies Stored));
    } catch {
      // Private mode without storage: the hash below is the only copy, keep it.
      return { invite, project };
    }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return pendingLink();
}

export function pendingLink(): PendingLink | null {
  const stored = read();
  if (!stored || (!stored.invite && !stored.project)) return null;
  return { invite: stored.invite, project: stored.project };
}

/** Forgets the pending link once it was handled, or can never be. */
export function clearPendingLink(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
