import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useDictation } from "./useDictation";

vi.mock("../lib/api", () => ({
  api: { transcribe: vi.fn() },
}));

vi.mock("../lib/auth", () => ({
  getToken: vi.fn(async () => "session-token"),
}));

class MockMediaRecorder {
  static readonly instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === "audio/webm;codecs=opus");
  readonly mimeType: string;
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    MockMediaRecorder.instances.push(this);
  }

  start = vi.fn(() => {
    this.state = "recording";
    this.onstart?.();
  });

  stop = vi.fn(() => {
    if (this.state === "inactive") return;
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) } as BlobEvent);
    this.state = "inactive";
    this.onstop?.();
  });
}

function Harness({ onCommit }: { readonly onCommit: (result: { value: string; selectionStart: number; selectionEnd: number }) => void }) {
  const dictation = useDictation({ language: "en-US", onCommit });
  return (
    <>
      <button data-start onClick={() => void dictation.start("hello world", { start: 6, end: 6 })} />
      <button data-stop onClick={dictation.stop} />
      <button data-cancel onClick={dictation.cancel} />
      <output data-status>{dictation.status}</output>
      <output data-preview>{dictation.previewText}</output>
      <output data-error>{dictation.error ?? ""}</output>
    </>
  );
}

describe("useDictation", () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;
  let tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tracks = [{ stop: vi.fn() }];
    getUserMedia = vi.fn(async () => ({ getTracks: () => tracks }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.mocked(api.transcribe).mockResolvedValue({ text: "there" });
  });

  afterEach(async () => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    MockMediaRecorder.instances.length = 0;
    vi.clearAllMocks();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    vi.unstubAllGlobals();
  });

  async function renderHarness(onCommit = vi.fn()) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Harness onCommit={onCommit} />);
      await Promise.resolve();
    });
    return onCommit;
  }

  it("records audio, sends it to the backend, and inserts the transcript", async () => {
    const onCommit = await renderHarness();
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("[data-start]")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.querySelector("[data-status]")?.textContent).toBe("listening");

    const recorder = MockMediaRecorder.instances[0];
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    expect(recorder.start).toHaveBeenCalledWith(250);

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("[data-stop]")?.click();
      await vi.waitFor(() => expect(onCommit).toHaveBeenCalledWith({ value: "hello thereworld", selectionStart: 11, selectionEnd: 11 }));
    });

    expect(api.transcribe).toHaveBeenCalledWith(expect.any(Blob), "prior-recording.webm", "session-token", expect.any(AbortSignal));
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(container?.querySelector("[data-status]")?.textContent).toBe("review");
  });

  it("cancels recording without uploading audio", async () => {
    await renderHarness();
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("[data-start]")?.click();
      await Promise.resolve();
      await Promise.resolve();
      container?.querySelector<HTMLButtonElement>("[data-cancel]")?.click();
    });

    expect(api.transcribe).not.toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(container?.querySelector("[data-status]")?.textContent).toBe("idle");
  });

  it("reports microphone permission failures", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await renderHarness();
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("[data-start]")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.querySelector("[data-error]")?.textContent).toContain("Microphone access was denied");
  });
});
