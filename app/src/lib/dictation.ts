export type TranscriptSnapshot = {
  finalText: string;
  interimText: string;
};

export type TranscriptResult = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
};

export type TranscriptResultList = {
  length: number;
  [index: number]: TranscriptResult;
};

export function assembleTranscript(results: TranscriptResultList): TranscriptSnapshot {
  let finalText = "";
  let interimText = "";
  for (const result of Array.from(results)) {
    const text = result?.[0]?.transcript ?? "";
    if (result?.isFinal) finalText += text;
    else interimText += text;
  }
  return { finalText, interimText };
}

export function insertTranscript(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  transcript: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const start = Math.max(0, Math.min(selectionStart, draft.length));
  const end = Math.max(start, Math.min(selectionEnd, draft.length));
  const value = `${draft.slice(0, start)}${transcript}${draft.slice(end)}`;
  const cursor = start + transcript.length;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}

export function transcriptText(snapshot: TranscriptSnapshot): string {
  return `${snapshot.finalText}${snapshot.interimText}`;
}
