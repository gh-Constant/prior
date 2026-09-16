import { assembleTranscript, type TranscriptSnapshot } from "./dictation";

export type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string; confidence?: number };
};

export type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

export type SpeechRecognitionEventLike = Event & {
  results: SpeechRecognitionResultListLike;
};

export type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
  message?: string;
};

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type LocalSpeechRecognitionConstructor = SpeechRecognitionConstructor & {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[] }) => Promise<boolean>;
};

export type SpeechRecognitionWindow = {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  isSecureContext?: boolean;
  location?: { hostname?: string };
};

export type SpeechRecognitionMode = "local" | "online";

export type SpeechRecognitionCapabilities = {
  available: boolean;
  mode: SpeechRecognitionMode;
  notice: string | null;
};

export type SpeechRecognitionProvider = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  dispose: () => void;
};

export type SpeechRecognitionProviderOptions = {
  language: string;
  mode?: SpeechRecognitionMode;
  scope?: SpeechRecognitionWindow | null;
  onSnapshot: (snapshot: TranscriptSnapshot) => void;
  onStart?: () => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

const ONLINE_NOTICE = "Your browser's speech service may process audio online.";

function getGlobalWindow(): SpeechRecognitionWindow | null {
  return typeof window === "undefined" ? null : window;
}

export function isSpeechRecognitionSecure(scope: SpeechRecognitionWindow | null = getGlobalWindow()): boolean {
  if (!scope || scope.isSecureContext === undefined) return true;
  if (scope.isSecureContext) return true;
  const hostname = scope.location?.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function getSpeechRecognitionConstructor(scope: SpeechRecognitionWindow | null = getGlobalWindow()): SpeechRecognitionConstructor | null {
  if (!scope || !isSpeechRecognitionSecure(scope)) return null;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionAvailable(scope: SpeechRecognitionWindow | null = getGlobalWindow()): boolean {
  return getSpeechRecognitionConstructor(scope) !== null;
}

export async function getSpeechRecognitionCapabilities(
  language: string,
  scope: SpeechRecognitionWindow | null = getGlobalWindow(),
): Promise<SpeechRecognitionCapabilities> {
  const Constructor = getSpeechRecognitionConstructor(scope);
  if (!Constructor) {
    return { available: false, mode: "online", notice: "Dictation is unavailable in this browser or app. You can still type or use your system keyboard dictation." };
  }

  const localConstructor = Constructor as LocalSpeechRecognitionConstructor;
  let supportsLocalProcess = false;
  try {
    supportsLocalProcess = "processLocally" in new Constructor();
  } catch {
    supportsLocalProcess = false;
  }
  if (localConstructor.available && supportsLocalProcess) {
    try {
      let availability = await localConstructor.available({ langs: [language], processLocally: true });
      if (availability === "downloadable" && localConstructor.install) {
        await localConstructor.install({ langs: [language] });
        availability = await localConstructor.available({ langs: [language], processLocally: true });
      }
      if (availability === "available") {
        return { available: true, mode: "local", notice: "On-device speech recognition is being used." };
      }
    } catch {
      // A failed optional local check is not a reason to block ordinary browser recognition.
    }
  }

  return { available: true, mode: "online", notice: ONLINE_NOTICE };
}

export function mapSpeechRecognitionError(error: unknown): string {
  const code = typeof error === "string" ? error : (error as SpeechRecognitionErrorEventLike | null)?.error;
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied or speech recognition is blocked. Check your browser permissions.";
    case "audio-capture":
      return "No usable microphone was found. You can still type or use your system keyboard dictation.";
    case "network":
      return "The browser speech service is unavailable right now. Check your connection and try again.";
    case "language-not-supported":
      return "This language is not supported by the browser speech service.";
    case "no-speech":
      return "No speech was detected. Try again when you are ready.";
    case "aborted":
      return "Dictation was cancelled.";
    default:
      return "Dictation stopped unexpectedly. You can try again or continue typing.";
  }
}

export function createSpeechRecognitionProvider(options: SpeechRecognitionProviderOptions): SpeechRecognitionProvider | null {
  const Constructor = getSpeechRecognitionConstructor(options.scope);
  if (!Constructor) return null;

  const recognition = new Constructor();
  let disposed = false;
  recognition.lang = options.language;
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;
  if (options.mode === "local" && "processLocally" in recognition) recognition.processLocally = true;

  recognition.onstart = () => {
    if (!disposed) options.onStart?.();
  };
  recognition.onresult = (event) => {
    if (!disposed) options.onSnapshot(assembleTranscript(event.results));
  };
  recognition.onerror = (event) => {
    if (!disposed && event.error !== "aborted") options.onError?.(mapSpeechRecognitionError(event));
  };
  recognition.onend = () => {
    if (!disposed) options.onEnd?.();
  };

  return {
    start: () => {
      if (!disposed) recognition.start();
    },
    stop: () => {
      if (!disposed) recognition.stop();
    },
    abort: () => {
      if (!disposed) recognition.abort();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try { recognition.abort(); } catch { /* The browser may already have ended the session. */ }
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    },
  };
}
