import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSpeechRecognitionProvider,
  getSpeechRecognitionCapabilities,
  mapSpeechRecognitionError,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
} from "./speechRecognition";

class MockRecognition implements SpeechRecognitionLike {
  static available = vi.fn(async () => "available");
  static instances: MockRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  processLocally = false;
  onstart: ((event: Event) => void) | null = null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  start = vi.fn(() => this.onstart?.(new Event("start")));
  stop = vi.fn(() => this.onend?.(new Event("end")));
  abort = vi.fn();

  constructor() {
    MockRecognition.instances.push(this);
  }
}

describe("browser speech recognition adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    MockRecognition.instances = [];
    delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it("configures the prefixed/unprefixed browser API and emits rebuilt snapshots", () => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockRecognition });
    const snapshots: Array<{ finalText: string; interimText: string }> = [];
    const provider = createSpeechRecognitionProvider({
      language: "fr-FR",
      mode: "local",
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    const recognition = MockRecognition.instances.at(-1);
    if (!recognition) throw new Error("Expected a recognition instance");

    expect(provider).not.toBeNull();
    expect(recognition.lang).toBe("fr-FR");
    expect(recognition.interimResults).toBe(true);
    expect(recognition.continuous).toBe(true);
    expect(recognition.maxAlternatives).toBe(1);
    expect(recognition.processLocally).toBe(true);

    recognition.onresult?.({
      results: {
        length: 1,
        0: { isFinal: false, length: 1, 0: { transcript: "bonjour" } },
      },
    } as unknown as SpeechRecognitionEventLike);
    expect(snapshots).toEqual([{ finalText: "", interimText: "bonjour" }]);

    provider?.dispose();
    recognition.onresult?.({ results: { length: 0 } } as unknown as SpeechRecognitionEventLike);
    expect(snapshots).toHaveLength(1);
  });

  it("uses verified local recognition when the optional APIs confirm the language", async () => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockRecognition });
    await expect(getSpeechRecognitionCapabilities("en-US")).resolves.toEqual({
      available: true,
      mode: "local",
      notice: "On-device speech recognition is being used.",
    });
    expect(MockRecognition.available).toHaveBeenCalledWith({ langs: ["en-US"], processLocally: true });
  });

  it("sanitizes browser error codes", () => {
    expect(mapSpeechRecognitionError({ error: "not-allowed" })).toContain("Microphone access was denied");
    expect(mapSpeechRecognitionError({ error: "network", message: "secret transcript" })).not.toContain("secret transcript");
  });
});
