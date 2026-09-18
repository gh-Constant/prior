import { translateStored } from "./i18n";

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

export type AudioCaptureCapabilities = {
  available: boolean;
  mimeType: string | null;
};

function mediaRecorderConstructor(): typeof MediaRecorder | null {
  return typeof globalThis.MediaRecorder === "function" ? globalThis.MediaRecorder : null;
}

export function getPreferredAudioMimeType(): string | null {
  const Constructor = mediaRecorderConstructor();
  if (!Constructor) return null;
  const supported = Constructor.isTypeSupported;
  if (typeof supported !== "function") return null;
  return PREFERRED_MIME_TYPES.find((mimeType) => supported.call(Constructor, mimeType)) ?? null;
}

export function getAudioCaptureCapabilities(): AudioCaptureCapabilities {
  const available = Boolean(
    typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      mediaRecorderConstructor(),
  );
  return { available, mimeType: available ? getPreferredAudioMimeType() : null };
}

export function audioFilenameForMimeType(mimeType: string | null): string {
  return mimeType?.toLowerCase().includes("mp4") ? "prior-recording.mp4" : "prior-recording.webm";
}

export function mapAudioCaptureError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : (error as { name?: unknown } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return translateStored("agent.audio.denied");
    case "NotFoundError":
    case "NotReadableError":
      return translateStored("agent.audio.notFound");
    case "AbortError":
      return translateStored("agent.audio.cancelled");
    default:
      return translateStored("agent.audio.failed");
  }
}

export function stopAudioTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    try { track.stop(); } catch { /* The host may already have closed the track. */ }
  }
}
