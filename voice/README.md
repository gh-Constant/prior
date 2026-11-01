# voice

Dictate into any app (Claude Code, a terminal, a browser, an editor): press a hotkey, talk, press it again, and the text is pasted where your cursor is.

```
hotkey → mic (live volume bar) → clean + trim silence → OpenRouter Whisper → paste
```

## Stack

| Piece | Choice | Why |
|---|---|---|
| Speech-to-text | `openai/whisper-large-v3-turbo` via [OpenRouter `/audio/transcriptions`](https://openrouter.ai/docs/guides/overview/multimodal/stt) | Listed at $0.000003 per second of audio (about $0.01 per hour), the cheapest tier on OpenRouter, and one API key for everything |
| Recording | `sounddevice`, 16 kHz mono | Whisper's native format, so no resampling and small uploads |
| Cleaning | numpy: DC removal, 60-100 Hz high-pass, adaptive silence trimming, peak normalization (max +30 dB) | Quiet and loud voices reach the model at the same level; you only pay for speech |
| Hotkey + paste | `pynput`, `pyperclip` | Works in any focused window; the clipboard is restored afterwards |

A 10-second dictation costs about $0.00003. A thousand of them cost about 3 cents.

## Setup

```bash
cd voice
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export OPENROUTER_API_KEY=sk-or-...        # https://openrouter.ai/keys, and add a few dollars of credit
export VOICE_LANG=fr                        # recommended: skips auto-detection, which can misfire on short phrases
python voice.py
```

Press **F9**, talk (a volume bar shows what the mic hears), press **F9** again. The text is pasted into the window that has focus.

System packages: Linux needs `libportaudio2` and `xclip` (or `wl-clipboard`); macOS needs `brew install portaudio` only if `pip install sounddevice` fails.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | required | Your OpenRouter key |
| `VOICE_LANG` | auto-detect | ISO-639-1 code, e.g. `fr`, `en` |
| `VOICE_HOTKEY` | `<f9>` | [pynput syntax](https://pynput.readthedocs.io/en/latest/keyboard.html#global-hotkeys), e.g. `<ctrl>+<alt>+d` |
| `VOICE_PASTE` | `cmd+v` macOS, `ctrl+v` Windows, `ctrl+shift+v` Linux | Paste shortcut. Linux terminals need `ctrl+shift+v`; set `ctrl+v` for GUI apps that do not accept it |
| `VOICE_MODEL` | `openai/whisper-large-v3-turbo` | Any model on the [OpenRouter STT list](https://openrouter.ai/collections/speech-to-text-models) |
| `VOICE_PROMPT` | none | Words to favor (names, jargon), e.g. `Claude Code, OpenRouter, Prior`. OpenRouter only forwards it to Groq-served models |
| `VOICE_DEVICE` | system default | Microphone index or name; list them with `python voice.py --list-devices` |

Other modes: `python voice.py --once` (Enter to start/stop, no global hotkey), `python voice.py --file audio.wav` (print the transcript of a file).

## Platform notes

- **macOS:** grant your terminal *Microphone* and *Accessibility* (System Settings → Privacy & Security). Accessibility is what lets it press the paste shortcut.
- **Linux:** works on X11. On Wayland, global hotkeys and key injection are blocked for apps like this; use `--once --no-paste` and paste yourself.
- **Windows:** works as is.

## Tests

```bash
python -m unittest test_voice -v
```

These cover the audio cleaning, the WAV encoding and the exact OpenRouter request, with no microphone, network or key needed.

## Not covered by the tests

The microphone capture, the global hotkey, the paste into another window and a real OpenRouter call need your machine and your key. Check the transcription quality in French on the model before relying on it: OpenRouter's pages give language counts for Whisper (99+ languages) but do not name French.
