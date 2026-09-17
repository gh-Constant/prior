import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audioFilenameForMimeType,
  getAudioCaptureCapabilities,
  getPreferredAudioMimeType,
  mapAudioCaptureError,
  stopAudioTracks,
} from "./audioCapture";

describe("audio capture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers WebM and falls back to MP4", () => {
    const isTypeSupported = vi.fn((mimeType: string) => mimeType === "audio/mp4");
    class SupportedRecorder {}
    Object.assign(SupportedRecorder, { isTypeSupported });
    vi.stubGlobal("MediaRecorder", SupportedRecorder);

    expect(getPreferredAudioMimeType()).toBe("audio/mp4");
    expect(audioFilenameForMimeType("audio/mp4")).toBe("prior-recording.mp4");
    expect(isTypeSupported).toHaveBeenCalledWith("audio/webm;codecs=opus");
  });

  it("reports capture availability from getUserMedia and MediaRecorder", () => {
    class SupportedRecorder {}
    Object.assign(SupportedRecorder, { isTypeSupported: () => true });
    vi.stubGlobal("MediaRecorder", SupportedRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });

    expect(getAudioCaptureCapabilities()).toEqual({ available: true, mimeType: "audio/webm;codecs=opus" });
  });

  it("stops every microphone track", () => {
    const first = { stop: vi.fn() };
    const second = { stop: vi.fn() };
    stopAudioTracks({ getTracks: () => [first, second] } as unknown as MediaStream);

    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it("maps permission errors without exposing implementation details", () => {
    expect(mapAudioCaptureError({ name: "NotAllowedError", message: "private detail" })).toContain("Microphone access was denied");
    expect(mapAudioCaptureError({ name: "NotAllowedError", message: "private detail" })).not.toContain("private detail");
  });
});
