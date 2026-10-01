import { useEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n";
import { notifyNow } from "../../lib/notificationScheduler";
import { formatCountdown, nextPhase, pomodoroStore, remainingMs, startPomodoro, usePomodoro } from "../../lib/pomodoro";

/** A soft two-note chime; silent where Web Audio is missing or blocked. */
export function playChime(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const start = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = start + index * 0.22;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 1);
    });
    window.setTimeout(() => void context.close().catch(() => undefined), 1600);
  } catch {
    // Sound is optional.
  }
}

type Props = {
  /** Shown in the app's toast when a phase ends. */
  readonly onNotice: (message: string) => void;
};

/**
 * Keeps the Focus timer going wherever the user is in the app: ends phases
 * on time, notifies, and shows the countdown in the window title.
 */
export function PomodoroRunner({ onNotice }: Props) {
  const { t } = useI18n();
  const state = usePomodoro();
  const running = state.endsAt !== null;
  const baseTitle = useRef<string | null>(null);
  const onNoticeRef = useRef(onNotice);
  useEffect(() => { onNoticeRef.current = onNotice; });

  useEffect(() => {
    if (!running || state.endsAt === null) return undefined;
    const finish = () => {
      const now = Date.now();
      const current = pomodoroStore.get();
      if (current.endsAt === null || remainingMs(current, now) > 0) return;
      const message = current.phase === "focus" ? t("focus.notice.focusDone") : t("focus.notice.breakDone");
      const next = nextPhase(current, current.phase === "focus" ? now : undefined);
      pomodoroStore.set(next.settings.autoStart ? startPomodoro(next, now) : next);
      onNoticeRef.current(message);
      if (current.settings.sound) playChime();
      void notifyNow("prior-focus", "Prior", message);
    };
    const delay = Math.max(0, state.endsAt - Date.now());
    const timer = window.setTimeout(finish, delay + 50);
    // Timers sleep with a hidden tab: check again when it comes back.
    const onVisible = () => { if (document.visibilityState === "visible") finish(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, state.endsAt, t]);

  // The countdown in the window title, so it shows in the tab and taskbar.
  useEffect(() => {
    if (!running) return undefined;
    if (baseTitle.current === null) baseTitle.current = document.title;
    const label = state.phase === "focus" ? t("focus.phase.focus") : t("focus.phase.break");
    const update = () => { document.title = `${formatCountdown(remainingMs(pomodoroStore.get(), Date.now()))} · ${label}`; };
    update();
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(timer);
      if (baseTitle.current !== null) document.title = baseTitle.current;
      baseTitle.current = null;
    };
  }, [running, state.phase, t]);

  return null;
}
