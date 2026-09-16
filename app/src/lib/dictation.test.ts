import { describe, expect, it } from "vitest";
import { assembleTranscript, insertTranscript, transcriptText } from "./dictation";

describe("dictation helpers", () => {
  it("rebuilds final and provisional text from the current result list", () => {
    const first = assembleTranscript({
      length: 2,
      0: { isFinal: true, length: 1, 0: { transcript: "Hello " } },
      1: { isFinal: false, length: 1, 0: { transcript: "wor" } },
    });
    const second = assembleTranscript({
      length: 2,
      0: { isFinal: true, length: 1, 0: { transcript: "Hello " } },
      1: { isFinal: true, length: 1, 0: { transcript: "world" } },
    });

    expect(first).toEqual({ finalText: "Hello ", interimText: "wor" });
    expect(transcriptText(second)).toBe("Hello world");
  });

  it("inserts text at a selection and returns the new caret", () => {
    expect(insertTranscript("before after", 7, 12, "middle")).toEqual({
      value: "before middle",
      selectionStart: 13,
      selectionEnd: 13,
    });
  });
});
