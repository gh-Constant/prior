/**
 * Presence: who of your co-members is here right now (specs/AGILE_COLLABORATION.md,
 * "Presence"). The client reports whether the user is active over the realtime
 * socket; the server keeps the best state across their connections and tells
 * co-members of shared projects.
 */

/** Green = online and active, orange = away (idle or hidden), grey = offline. */
export type PersonPresence = "online" | "away" | "offline";
export type Activity = "active" | "idle";

/** No interaction (or a hidden app) for this long means "away". */
export const IDLE_AFTER_MS = 5 * 60_000;

/** What the API sends for a member or a poker participant. */
export type PresenceFields = { online?: boolean; presence?: string };

/** Maps the API fields onto a state; older servers only send `online`. */
export function presenceFromApi(fields: PresenceFields): PersonPresence {
  if (fields.presence === "online" || fields.presence === "away" || fields.presence === "offline") return fields.presence;
  return fields.online ? "online" : "offline";
}

export function presenceLabelKey(presence: PersonPresence): "collab.presence.online" | "collab.presence.away" | "collab.presence.offline" {
  switch (presence) {
    case "online": return "collab.presence.online";
    case "away": return "collab.presence.away";
    case "offline": return "collab.presence.offline";
  }
}

type TrackerOptions = {
  onChange: (activity: Activity) => void;
  idleAfterMs?: number;
  now?: () => number;
  target?: Window;
};

const INTERACTION_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"] as const;

/**
 * Watches for user interaction and reports "idle" after IDLE_AFTER_MS without
 * any (a hidden tab or a backgrounded app produces none), "active" again on
 * the next interaction or when the app comes back to the foreground.
 */
export function startActivityTracker({ onChange, idleAfterMs = IDLE_AFTER_MS, now = Date.now, target = window }: TrackerOptions): { stop: () => void; current: () => Activity } {
  let lastActivity = now();
  let state: Activity = "active";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: Activity) => {
    if (next === state) return;
    state = next;
    onChange(next);
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (now() - lastActivity >= idleAfterMs) set("idle");
      else schedule();
    }, Math.max(1_000, lastActivity + idleAfterMs - now()));
  };
  const touch = () => {
    lastActivity = now();
    set("active");
    // Restart the clock only when it is not already running for this window.
    if (timer === undefined) schedule();
  };
  const onVisibility = () => {
    if (target.document.visibilityState === "visible") touch();
  };

  for (const name of INTERACTION_EVENTS) target.addEventListener(name, touch, { passive: true, capture: true });
  target.document.addEventListener("visibilitychange", onVisibility);
  schedule();

  return {
    current: () => state,
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      for (const name of INTERACTION_EVENTS) target.removeEventListener(name, touch, { capture: true });
      target.document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
