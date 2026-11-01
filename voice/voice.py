#!/usr/bin/env python3
"""voice - dictate into any app (Claude Code, terminal, browser, editor).

Press a hotkey, talk, press it again: the audio is cleaned, transcribed by
Whisper through OpenRouter, and the text is pasted where your cursor is.

    export OPENROUTER_API_KEY=sk-or-...
    python voice.py              # global hotkey (default F9), runs in background
    python voice.py --once       # no hotkey: Enter to start, Enter to stop
    python voice.py --file a.wav # transcribe a file, print the text

See README.md for setup and the VOICE_* settings.
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import platform
import sys
import threading
import time
import wave

import numpy as np
import requests

SR = 16_000            # Whisper's native rate; also keeps uploads small and fast
FRAME = SR // 50       # 20 ms analysis frames
HANG = 10              # keep 200 ms around speech so word endings are not clipped
MIN_SPEECH_FRAMES = 8  # < 160 ms of voiced audio is treated as "nothing said"
MAX_GAIN = 10 ** (30 / 20)  # +30 dB
API_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

MODEL = os.getenv("VOICE_MODEL", "openai/whisper-large-v3-turbo")
LANGUAGE = os.getenv("VOICE_LANG") or None   # e.g. "fr"; unset = auto-detect
VOCAB = os.getenv("VOICE_PROMPT") or None    # names/jargon hint (used by Groq-served models)
HOTKEY = os.getenv("VOICE_HOTKEY", "<f9>")   # pynput syntax, e.g. "<ctrl>+<alt>+d"
DEVICE = os.getenv("VOICE_DEVICE") or None   # input device index or name
_PASTE_DEFAULT = {"Darwin": "cmd+v", "Windows": "ctrl+v"}.get(platform.system(), "ctrl+shift+v")
PASTE_KEYS = os.getenv("VOICE_PASTE", _PASTE_DEFAULT)  # terminals on Linux need ctrl+shift+v


def log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


# --------------------------------------------------------------------------- audio

def clean(audio: np.ndarray, sr: int = SR) -> np.ndarray | None:
    """Mono float32 in [-1, 1] -> cleaned audio, or None when nobody spoke.

    - removes DC offset and low rumble (desk thumps, fans, AC hum)
    - drops silence (leading, trailing, and long pauses) so you pay for and
      upload only the speech, and Whisper cannot hallucinate on dead air
    - normalizes the volume so quiet and loud voices reach the model alike
    """
    x = np.asarray(audio, dtype=np.float32)
    if x.size < FRAME * MIN_SPEECH_FRAMES:
        return None
    x = x - x.mean()

    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(x.size, 1 / sr)
    spec *= np.clip((freqs - 60) / 40, 0, 1)          # smooth high-pass, 60-100 Hz
    x = np.fft.irfft(spec, n=x.size).astype(np.float32)

    n = x.size // FRAME
    frames = x[: n * FRAME].reshape(n, FRAME)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    # Threshold adapts to the room: ~3x the noise floor, but never above 10% of the
    # loudest frame (so continuous speech is not mistaken for noise), never below -50 dBFS.
    thr = max(10 ** (-50 / 20), min(np.percentile(rms, 10) * 3, rms.max() * 0.1))
    voiced = rms > thr
    if voiced.sum() < MIN_SPEECH_FRAMES:
        return None

    keep = voiced.copy()
    for s in range(1, HANG + 1):                      # dilate the speech mask
        keep[s:] |= voiced[:-s]
        keep[:-s] |= voiced[s:]
    y = frames[keep].reshape(-1)

    peak = float(np.abs(y).max())
    # Peak to ~-3 dBFS. Gain is capped at +30 dB so a dead-quiet mic is not blown up into
    # pure hiss (silence is already stripped, so little noise is left to amplify).
    y = np.clip(y * min(0.7 / peak, MAX_GAIN), -1.0, 1.0)
    return y.astype(np.float32)


def to_wav(y: np.ndarray) -> bytes:
    pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def load_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise SystemExit("only 16-bit PCM wav files are supported with --file")
        ch, rate = w.getnchannels(), w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    if rate != SR:
        data = np.interp(np.arange(0, data.size, rate / SR), np.arange(data.size), data)
    return data.astype(np.float32)


class Recorder:
    """Microphone capture with a live input level for the meter."""

    def __init__(self) -> None:
        self.chunks: list[np.ndarray] = []
        self.level = 0.0
        self.stream = None

    def _callback(self, indata, frames, time_info, status) -> None:
        x = indata[:, 0].copy()
        self.chunks.append(x)
        self.level = float(np.sqrt(np.mean(x ** 2)))

    def start(self) -> None:
        import sounddevice as sd  # imported late: needs PortAudio, not needed for --file

        device = int(DEVICE) if DEVICE and DEVICE.isdigit() else DEVICE
        self.chunks, self.level = [], 0.0
        self.stream = sd.InputStream(samplerate=SR, channels=1, dtype="float32",
                                     blocksize=SR // 20, device=device, callback=self._callback)
        self.stream.start()

    def stop(self) -> np.ndarray:
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None
        return np.concatenate(self.chunks) if self.chunks else np.zeros(0, dtype=np.float32)


def meter(rec: Recorder, stop: threading.Event) -> None:
    """Live volume bar so you can see the mic hears you."""
    t0 = time.time()
    while not stop.is_set():
        db = 20 * np.log10(rec.level + 1e-9)
        width = int(np.clip((db + 60) / 60, 0, 1) * 30)
        hint = "  (too quiet)" if db < -50 else ""
        sys.stderr.write(f"\r● REC {time.time() - t0:4.1f}s [{'█' * width}{'·' * (30 - width)}] {db:5.1f} dB{hint}   ")
        sys.stderr.flush()
        time.sleep(0.05)
    sys.stderr.write("\r" + " " * 78 + "\r")
    sys.stderr.flush()


# --------------------------------------------------------------------------- API

def make_session() -> requests.Session:
    s = requests.Session()
    s.headers["X-Title"] = "voice"
    return s


def warm(session: requests.Session) -> None:
    """Open the TLS connection while you are still talking, so upload starts instantly."""
    def _go() -> None:
        try:
            session.head("https://openrouter.ai", timeout=5)
        except requests.RequestException:
            pass
    threading.Thread(target=_go, daemon=True).start()


def transcribe(wav: bytes, key: str, session: requests.Session) -> tuple[str, dict]:
    body: dict = {"model": MODEL,
                  "input_audio": {"data": base64.b64encode(wav).decode(), "format": "wav"}}
    if LANGUAGE:
        body["language"] = LANGUAGE
    if VOCAB:
        body["provider"] = {"options": {"groq": {"prompt": VOCAB}}}

    last: Exception | None = None
    for _ in range(2):
        try:
            r = session.post(API_URL, json=body, headers={"Authorization": f"Bearer {key}"},
                             timeout=(5, 45))
        except requests.RequestException as e:
            last = e
            continue
        if r.status_code == 429 or r.status_code >= 500:
            last = RuntimeError(f"OpenRouter {r.status_code}: {r.text[:200]}")
            time.sleep(0.4)
            continue
        if r.status_code != 200:
            raise RuntimeError(f"OpenRouter {r.status_code}: {r.text[:300]}")
        data = r.json()
        return data["text"].strip(), data.get("usage", {})
    raise RuntimeError(f"transcription failed: {last}")


def process(audio: np.ndarray, key: str, session: requests.Session) -> str | None:
    y = clean(audio)
    if y is None:
        log("no speech detected - nothing sent (check the mic level)")
        return None
    t0 = time.time()
    text, usage = transcribe(to_wav(y), key, session)
    log(f"✓ {len(y) / SR:.1f}s of speech · {time.time() - t0:.2f}s · ${usage.get('cost', 0):.6f}")
    return text or None


# --------------------------------------------------------------------------- paste

def paste(text: str) -> None:
    """Put text on the clipboard, press the paste shortcut, then restore the clipboard."""
    import pyperclip
    from pynput.keyboard import Controller, Key

    mods = {"ctrl": Key.ctrl, "shift": Key.shift, "alt": Key.alt, "cmd": Key.cmd}
    *held_names, letter = PASTE_KEYS.lower().split("+")
    previous = None
    try:
        previous = pyperclip.paste()
    except pyperclip.PyperclipException:
        pass
    pyperclip.copy(text)
    time.sleep(0.05)
    kb = Controller()
    held = [mods[m] for m in held_names]
    for m in held:
        kb.press(m)
    kb.press(letter)
    kb.release(letter)
    for m in reversed(held):
        kb.release(m)
    time.sleep(0.25)  # let the target app read the clipboard before we restore it
    if previous is not None:
        pyperclip.copy(previous)


# --------------------------------------------------------------------------- modes

def run_hotkey(key: str) -> None:
    from pynput import keyboard

    rec, session = Recorder(), make_session()
    lock = threading.Lock()
    state = {"recording": False, "stop_meter": threading.Event()}

    def finish(audio: np.ndarray) -> None:
        try:
            text = process(audio, key, session)
            if text:
                paste(text)
        except Exception as e:  # keep the daemon alive whatever happens
            log(f"error: {e}")

    def toggle() -> None:
        with lock:
            if not state["recording"]:
                warm(session)
                rec.start()
                state["recording"] = True
                state["stop_meter"] = threading.Event()
                threading.Thread(target=meter, args=(rec, state["stop_meter"]), daemon=True).start()
            else:
                state["recording"] = False
                state["stop_meter"].set()
                audio = rec.stop()
                threading.Thread(target=finish, args=(audio,), daemon=True).start()

    log(f"voice ready: press {HOTKEY} to start/stop dictation · model {MODEL} · paste {PASTE_KEYS}")
    with keyboard.GlobalHotKeys({HOTKEY: toggle}) as h:
        h.join()


def run_once(key: str, do_paste: bool) -> None:
    import pyperclip

    rec, session = Recorder(), make_session()
    input("Press Enter to start recording... ")
    warm(session)
    rec.start()
    stop = threading.Event()
    threading.Thread(target=meter, args=(rec, stop), daemon=True).start()
    input()
    stop.set()
    text = process(rec.stop(), key, session)
    if not text:
        return
    print(text)
    pyperclip.copy(text)
    log("copied to clipboard")
    if do_paste:
        time.sleep(1.5)  # time to focus the target window
        paste(text)


def main() -> None:
    p = argparse.ArgumentParser(description="Dictate into any app with Whisper via OpenRouter.")
    p.add_argument("--once", action="store_true", help="single recording, Enter to start/stop (no global hotkey)")
    p.add_argument("--file", help="transcribe a 16-bit wav file and print the text")
    p.add_argument("--no-paste", action="store_true", help="with --once: only copy to the clipboard")
    p.add_argument("--list-devices", action="store_true", help="list microphones and exit")
    args = p.parse_args()

    if args.list_devices:
        import sounddevice as sd
        print(sd.query_devices())
        return

    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("Set OPENROUTER_API_KEY (https://openrouter.ai/keys)")

    if args.file:
        text = process(load_wav(args.file), key, make_session())
        if text:
            print(text)
    elif args.once:
        run_once(key, do_paste=not args.no_paste)
    else:
        run_hotkey(key)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
