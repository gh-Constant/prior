// Tiny synthesized sounds for the gamified mode: no audio files, a few
// oscillator notes shaped by gain envelopes. Off unless the player turned
// sounds on in Settings → Game.

export type GameSound = "complete" | "levelUp" | "chest" | "achievement";

type Note = { readonly frequency: number; readonly at: number; readonly duration: number; readonly gain?: number; readonly type?: OscillatorType };

const SOUNDS: Readonly<Record<GameSound, readonly Note[]>> = {
  // A bright two-note chime.
  complete: [
    { frequency: 880, at: 0, duration: 0.12, gain: 0.16, type: "triangle" },
    { frequency: 1318.5, at: 0.07, duration: 0.22, gain: 0.14, type: "triangle" },
  ],
  // A rising major arpeggio with a sparkle on top.
  levelUp: [
    { frequency: 523.25, at: 0, duration: 0.16, gain: 0.14, type: "triangle" },
    { frequency: 659.25, at: 0.1, duration: 0.16, gain: 0.14, type: "triangle" },
    { frequency: 783.99, at: 0.2, duration: 0.18, gain: 0.14, type: "triangle" },
    { frequency: 1046.5, at: 0.3, duration: 0.42, gain: 0.16, type: "triangle" },
    { frequency: 2093, at: 0.36, duration: 0.3, gain: 0.05, type: "sine" },
  ],
  chest: [
    { frequency: 392, at: 0, duration: 0.1, gain: 0.12, type: "square" },
    { frequency: 1567.98, at: 0.12, duration: 0.3, gain: 0.08, type: "sine" },
    { frequency: 2093, at: 0.2, duration: 0.3, gain: 0.06, type: "sine" },
  ],
  achievement: [
    { frequency: 698.46, at: 0, duration: 0.14, gain: 0.13, type: "triangle" },
    { frequency: 1046.5, at: 0.09, duration: 0.3, gain: 0.13, type: "triangle" },
  ],
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  context ??= new Constructor();
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

/** Plays a sound now. Silently does nothing where Web Audio is unavailable. */
export function playSound(sound: GameSound): void {
  try {
    const audio = audioContext();
    if (!audio) return;
    const start = audio.currentTime + 0.01;
    const master = audio.createGain();
    master.gain.value = 0.8;
    master.connect(audio.destination);
    for (const note of SOUNDS[sound]) {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.type = note.type ?? "sine";
      oscillator.frequency.value = note.frequency;
      const begin = start + note.at;
      const peak = note.gain ?? 0.12;
      envelope.gain.setValueAtTime(0.0001, begin);
      envelope.gain.exponentialRampToValueAtTime(peak, begin + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, begin + note.duration);
      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.start(begin);
      oscillator.stop(begin + note.duration + 0.02);
    }
  } catch {
    // Audio is a nicety; never let it break a completion.
  }
}
