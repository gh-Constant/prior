import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { getToken } from "../lib/auth";
import { translateStored } from "../lib/i18n";
import { insertTranscript, type TranscriptSnapshot } from "../lib/dictation";
import {
  audioFilenameForMimeType,
  getAudioCaptureCapabilities,
  getPreferredAudioMimeType,
  mapAudioCaptureError,
  stopAudioTracks,
} from "../lib/audioCapture";

export type DictationStatus = "unavailable" | "idle" | "preparing" | "listening" | "stopping" | "review" | "error";

export type DictationSelection = {
  start: number;
  end: number;
};

type DictationSession = {
  id: number;
  draft: string;
  selection: DictationSelection;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  mimeType: string;
  recordingTimer: number | null;
  maxTimer: number | null;
  startedAt: number;
  maxDurationReached: boolean;
  finalizing: boolean;
  transcriptionAbort: AbortController | null;
};

type UseDictationOptions = {
  enabled?: boolean;
  language: string;
  onCommit: (result: { value: string; selectionStart: number; selectionEnd: number }) => void;
};

export type DictationSnapshot = TranscriptSnapshot;

const MAX_RECORDING_MS = 120_000;

export const MICROPHONE_BLOCKED_MESSAGE =
  "Prior could not open the microphone. Allow microphone access for this site or app, then try again.";

function clearTimer(timer: number | null): void {
  if (timer !== null && typeof window !== "undefined") window.clearTimeout(timer);
}

function clearIntervalTimer(timer: number | null): void {
  if (timer !== null && typeof window !== "undefined") window.clearInterval(timer);
}

function mapTranscriptionError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return translateStored("agent.dictation.cancelled");
  if (error instanceof Error && error.message) return error.message;
  return translateStored("agent.dictation.transcribeFailed");
}

export function useDictation({ enabled = true, language: _language, onCommit }: UseDictationOptions) {
  const initiallyAvailable = getAudioCaptureCapabilities().available;
  const [status, setStatus] = useState<DictationStatus>(initiallyAvailable ? "idle" : "unavailable");
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const sessionRef = useRef<DictationSession | null>(null);
  const sessionNumberRef = useRef(0);
  const draftRef = useRef<{ draft: string; selection: DictationSelection } | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const isCurrent = (id: number): boolean => sessionRef.current?.id === id;

  function clearPreview(): void {
    setFinalText("");
    setInterimText("");
    setElapsedMs(0);
    setWarning(null);
  }

  function releaseSession(session: DictationSession): void {
    clearIntervalTimer(session.recordingTimer);
    clearTimer(session.maxTimer);
    session.recordingTimer = null;
    session.maxTimer = null;
    session.transcriptionAbort?.abort();
    session.transcriptionAbort = null;
    const recorder = session.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstart = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* The recording is being discarded. */ }
      }
    }
    session.recorder = null;
    stopAudioTracks(session.stream);
    session.stream = null;
  }

  function finishWithError(id: number, message: string): void {
    const session = sessionRef.current;
    if (session?.id !== id) return;
    sessionRef.current = null;
    releaseSession(session);
    draftRef.current = null;
    clearPreview();
    setError(message);
    setStatus("error");
  }

  function finishWithTranscript(id: number, text: string): void {
    const session = sessionRef.current;
    if (session?.id !== id) return;
    sessionRef.current = null;
    releaseSession(session);

    const transcript = text.trim();
    const draft = draftRef.current;
    if (!transcript || !draft) {
      draftRef.current = null;
      setFinalText("");
      setInterimText("");
      setError(translateStored("agent.dictation.noSpeech"));
      setStatus("error");
      return;
    }

    const result = insertTranscript(draft.draft, draft.selection.start, draft.selection.end, transcript);
    draftRef.current = null;
    setFinalText(transcript);
    setInterimText("");
    setError(null);
    setWarning(session.maxDurationReached ? translateStored("agent.dictation.maxDuration") : null);
    setStatus("review");
    onCommitRef.current(result);
  }

  async function transcribeRecording(id: number): Promise<void> {
    const session = sessionRef.current;
    if (session?.id !== id || session.finalizing === false) return;
    stopAudioTracks(session.stream);
    session.stream = null;
    const recorder = session.recorder;
    session.recorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstart = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    const audio = new Blob(session.chunks, { type: session.mimeType || undefined });
    if (audio.size === 0) {
      finishWithError(id, translateStored("agent.dictation.micBlocked"));
      return;
    }

    try {
      const token = await getToken();
      if (!token) throw new Error(translateStored("agent.dictation.signIn"));
      if (!isCurrent(id)) return;
      const controller = new AbortController();
      session.transcriptionAbort = controller;
      const result = await api.transcribe(audio, audioFilenameForMimeType(session.mimeType || null), token, controller.signal);
      if (isCurrent(id)) finishWithTranscript(id, result.text);
    } catch (error_) {
      if (isCurrent(id)) finishWithError(id, mapTranscriptionError(error_));
    }
  }

  async function start(draft: string, selection: DictationSelection): Promise<boolean> {
    if (!enabled || sessionRef.current || status === "preparing" || status === "listening" || status === "stopping") return false;
    const capabilities = getAudioCaptureCapabilities();
    if (!capabilities.available || typeof navigator === "undefined") {
      setError(translateStored("agent.dictation.unavailable"));
      setStatus("unavailable");
      return false;
    }

    const id = sessionNumberRef.current + 1;
    sessionNumberRef.current = id;
    const session: DictationSession = {
      id,
      draft,
      selection,
      stream: null,
      recorder: null,
      chunks: [],
      mimeType: getPreferredAudioMimeType() ?? "",
      recordingTimer: null,
      maxTimer: null,
      startedAt: Date.now(),
      maxDurationReached: false,
      finalizing: false,
      transcriptionAbort: null,
    };
    sessionRef.current = session;
    draftRef.current = { draft, selection };
    clearPreview();
    setError(null);
    setStatus("preparing");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error_) {
      if (isCurrent(id)) finishWithError(id, mapAudioCaptureError(error_));
      return false;
    }
    if (!isCurrent(id)) {
      stopAudioTracks(stream);
      return false;
    }
    session.stream = stream;

    try {
      const recorder = session.mimeType
        ? new MediaRecorder(stream, { mimeType: session.mimeType })
        : new MediaRecorder(stream);
      session.recorder = recorder;
      session.mimeType = recorder.mimeType || session.mimeType;
      recorder.ondataavailable = (event) => {
        if (isCurrent(id) && event.data.size > 0) session.chunks.push(event.data);
      };
      recorder.onstart = () => {
        if (isCurrent(id)) setStatus("listening");
      };
      recorder.onstop = () => {
        if (isCurrent(id)) void transcribeRecording(id);
      };
      recorder.onerror = () => {
        if (isCurrent(id)) finishWithError(id, translateStored("agent.dictation.recordFailed"));
      };
      recorder.start(250);
    } catch (error_) {
      if (isCurrent(id)) finishWithError(id, mapAudioCaptureError(error_));
      return false;
    }

    setStatus("listening");
    session.startedAt = Date.now();
    session.recordingTimer = window.setInterval(() => {
      if (isCurrent(id)) setElapsedMs(Date.now() - session.startedAt);
    }, 250);
    session.maxTimer = window.setTimeout(() => {
      if (!isCurrent(id)) return;
      session.maxDurationReached = true;
      stop();
    }, MAX_RECORDING_MS);
    return true;
  }

  function stop(): void {
    const session = sessionRef.current;
    if (!session || session.finalizing) return;
    session.finalizing = true;
    clearIntervalTimer(session.recordingTimer);
    clearTimer(session.maxTimer);
    session.recordingTimer = null;
    session.maxTimer = null;
    setElapsedMs(Date.now() - session.startedAt);
    setStatus("stopping");
    try {
      if (session.recorder?.state === "inactive") void transcribeRecording(session.id);
      else session.recorder?.stop();
    } catch (error_) {
      finishWithError(session.id, mapAudioCaptureError(error_));
    }
  }

  function cancel(): void {
    const session = sessionRef.current;
    if (session) {
      sessionRef.current = null;
      sessionNumberRef.current += 1;
      releaseSession(session);
    }
    draftRef.current = null;
    clearPreview();
    setError(null);
    setStatus(getAudioCaptureCapabilities().available ? "idle" : "unavailable");
  }

  useEffect(() => {
    if (enabled) return undefined;
    cancel();
    return undefined;
  }, [enabled]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && sessionRef.current && !sessionRef.current.finalizing) stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    sessionNumberRef.current += 1;
    releaseSession(session);
  }, []);

  const isActive = status === "preparing" || status === "listening" || status === "stopping";
  return {
    status,
    finalText,
    interimText,
    previewText: finalText,
    elapsedMs,
    error,
    warning,
    isActive,
    canStart: status === "idle" || status === "review" || status === "error",
    start,
    stop,
    cancel,
  };
}
