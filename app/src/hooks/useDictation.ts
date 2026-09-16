import { useEffect, useRef, useState } from "react";
import { insertTranscript, transcriptText, type TranscriptSnapshot } from "../lib/dictation";
import {
  createSpeechRecognitionProvider,
  getSpeechRecognitionCapabilities,
  isSpeechRecognitionAvailable,
  mapSpeechRecognitionError,
  requestMicrophoneAccess,
  type SpeechRecognitionMode,
  type SpeechRecognitionProvider,
} from "../lib/speechRecognition";

export type DictationStatus = "unavailable" | "idle" | "preparing" | "listening" | "stopping" | "review" | "error";

export type DictationSelection = {
  start: number;
  end: number;
};

type DictationSession = {
  id: number;
  draft: string;
  selection: DictationSelection;
  provider: SpeechRecognitionProvider | null;
  snapshot: TranscriptSnapshot;
  timer: number | null;
  stopRequested: boolean;
};

type UseDictationOptions = {
  enabled?: boolean;
  language: string;
  onCommit: (result: { value: string; selectionStart: number; selectionEnd: number }) => void;
};

const STOP_WATCHDOG_MS = 3000;
const MAX_SESSION_MS = 120000;

function clearTimer(timer: number | null): void {
  if (timer !== null && typeof window !== "undefined") window.clearTimeout(timer);
}

export function useDictation({ enabled = true, language, onCommit }: UseDictationOptions) {
  const initiallyAvailable = isSpeechRecognitionAvailable();
  const [status, setStatus] = useState<DictationStatus>(initiallyAvailable ? "idle" : "unavailable");
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [mode, setMode] = useState<SpeechRecognitionMode>("online");
  const [notice, setNotice] = useState<string | null>(initiallyAvailable ? "Your browser's speech service may process audio online." : null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const sessionRef = useRef<DictationSession | null>(null);
  const sessionNumberRef = useRef(0);
  const draftRef = useRef<{ draft: string; selection: DictationSelection } | null>(null);
  const onCommitRef = useRef(onCommit);
  const languageRef = useRef(language);

  onCommitRef.current = onCommit;
  languageRef.current = language;

  const isCurrent = (id: number): boolean => sessionRef.current?.id === id;

  function disposeSession(session: DictationSession): void {
    clearTimer(session.timer);
    session.timer = null;
    session.provider?.dispose();
    session.provider = null;
  }

  function clearPreview(): void {
    setFinalText("");
    setInterimText("");
    setWarning(null);
  }

  function completeSession(id: number, message?: string): void {
    const session = sessionRef.current;
    if (!session || session.id !== id) return;
    sessionRef.current = null;
    disposeSession(session);

    const captured = transcriptText(session.snapshot);
    if (captured.trim() && draftRef.current) {
      const result = insertTranscript(session.draft, session.selection.start, session.selection.end, captured);
      onCommitRef.current(result);
      draftRef.current = null;
      setWarning(session.snapshot.interimText.trim() ? "Some words were still provisional; review the inserted text before sending." : null);
      setStatus(message ? "error" : "review");
      setError(message ?? null);
      return;
    }

    setError(message ?? "No speech was detected. Try again when you are ready.");
    setStatus("error");
  }

  function finishWithError(id: number, message: string): void {
    const session = sessionRef.current;
    if (!session || session.id !== id) return;
    sessionRef.current = null;
    disposeSession(session);
    const captured = transcriptText(session.snapshot);
    if (captured.trim() && draftRef.current) {
      onCommitRef.current(insertTranscript(session.draft, session.selection.start, session.selection.end, captured));
      draftRef.current = null;
    }
    setError(message);
    setWarning(session.snapshot.interimText.trim() ? "A partial preview is available below." : null);
    setStatus("error");
  }

  async function start(draft: string, selection: DictationSelection): Promise<boolean> {
    if (!enabled || sessionRef.current || status === "preparing" || status === "listening" || status === "stopping") return false;

    const id = sessionNumberRef.current + 1;
    sessionNumberRef.current = id;
    const session: DictationSession = {
      id,
      draft,
      selection,
      provider: null,
      snapshot: { finalText: "", interimText: "" },
      timer: null,
      stopRequested: false,
    };
    sessionRef.current = session;
    draftRef.current = { draft, selection };
    clearPreview();
    setError(null);
    setStatus("preparing");

    try {
      await requestMicrophoneAccess();
      if (!isCurrent(id)) return false;
      if (!isSpeechRecognitionAvailable()) {
        finishWithError(id, "Dictation is unavailable in this browser or app. You can still type or use your system keyboard dictation.");
        return false;
      }
      const capabilities = await getSpeechRecognitionCapabilities(languageRef.current);
      if (!isCurrent(id)) return false;
      setMode(capabilities.mode);
      setNotice(capabilities.notice);
      if (session.stopRequested) {
        finishWithError(id, "Dictation stopped before microphone access completed.");
        return false;
      }
      if (!capabilities.available) {
        finishWithError(id, capabilities.notice ?? "Dictation is unavailable in this browser or app.");
        return false;
      }

      const provider = createSpeechRecognitionProvider({
        language: languageRef.current,
        mode: capabilities.mode,
        onStart: () => {
          if (isCurrent(id)) setStatus("listening");
        },
        onSnapshot: (snapshot) => {
          const current = sessionRef.current;
          if (!current || current.id !== id) return;
          current.snapshot = snapshot;
          setFinalText(snapshot.finalText);
          setInterimText(snapshot.interimText);
        },
        onError: (message) => {
          if (isCurrent(id)) finishWithError(id, message);
        },
        onEnd: () => {
          if (isCurrent(id)) completeSession(id);
        },
      });

      if (!provider) {
        finishWithError(id, "Dictation is unavailable in this browser or app. You can still type or use your system keyboard dictation.");
        return false;
      }
      session.provider = provider;
      session.timer = window.setTimeout(() => {
        if (isCurrent(id)) completeSession(id, "Dictation reached its two-minute safety limit. Review the inserted text before sending.");
      }, MAX_SESSION_MS);
      provider.start();
      return true;
    } catch (caught: unknown) {
      if (isCurrent(id)) finishWithError(id, mapSpeechRecognitionError(caught));
      return false;
    }
  }

  function stop(): void {
    const session = sessionRef.current;
    if (!session) return;
    session.stopRequested = true;
    setStatus("stopping");
    try {
      session.provider?.stop();
    } catch (caught: unknown) {
      completeSession(session.id, mapSpeechRecognitionError(caught));
      return;
    }
    if (!isCurrent(session.id)) return;
    clearTimer(session.timer);
    session.timer = window.setTimeout(() => {
      if (isCurrent(session.id)) completeSession(session.id, session.snapshot.interimText.trim() ? "Speech capture ended before all words were finalized. The visible preview was inserted so you can review it." : undefined);
    }, STOP_WATCHDOG_MS);
  }

  function cancel(): void {
    const session = sessionRef.current;
    if (session) {
      sessionRef.current = null;
      sessionNumberRef.current += 1;
      clearTimer(session.timer);
      try { session.provider?.abort(); } catch { /* The session is cancelled regardless. */ }
      disposeSession(session);
    }
    draftRef.current = null;
    clearPreview();
    setError(null);
    setStatus(isSpeechRecognitionAvailable() ? "idle" : "unavailable");
  }

  useEffect(() => {
    if (enabled) return undefined;
    stop();
    return undefined;
  }, [enabled]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    sessionNumberRef.current += 1;
    disposeSession(session);
  }, []);

  const isActive = status === "preparing" || status === "listening" || status === "stopping";
  return {
    status,
    finalText,
    interimText,
    previewText: `${finalText}${interimText}`,
    mode,
    notice,
    error,
    warning,
    isActive,
    canStart: status === "idle" || status === "review" || status === "error",
    start,
    stop,
    cancel,
  };
}
