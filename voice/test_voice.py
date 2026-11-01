"""Offline tests: audio cleaning, WAV encoding and the OpenRouter request shape.

Run with:  python -m unittest test_voice -v
(no microphone, network or API key needed)
"""
import base64
import io
import unittest
import wave
from unittest import mock

import numpy as np

import voice

SR = voice.SR


def tone(seconds, amp, freq=220.0):
    t = np.arange(int(seconds * SR)) / SR
    # harmonics make it a bit more voice-like than a pure sine
    return amp * (np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * 2 * freq * t)) / 1.5


def noise(seconds, amp, seed=0):
    return amp * np.random.default_rng(seed).standard_normal(int(seconds * SR))


class CleanTests(unittest.TestCase):
    def test_silence_and_room_noise_return_none(self):
        self.assertIsNone(voice.clean(np.zeros(SR * 2)))
        self.assertIsNone(voice.clean(noise(2, 0.0005)))

    def test_too_short_returns_none(self):
        self.assertIsNone(voice.clean(tone(0.05, 0.5)))

    def test_long_pauses_are_removed(self):
        audio = np.concatenate([noise(1, 0.001), tone(1, 0.3), noise(4, 0.001, 1),
                                tone(1, 0.3), noise(1, 0.001, 2)])
        y = voice.clean(audio)
        self.assertIsNotNone(y)
        # 2 s of speech + ~200 ms hang on each side of each burst, far below the 7 s input
        self.assertLess(len(y) / SR, 3.5)
        self.assertGreater(len(y) / SR, 1.9)

    def test_quiet_voice_is_normalized(self):
        y = voice.clean(np.concatenate([noise(0.5, 0.0005), tone(1, 0.05), noise(0.5, 0.0005, 3)]))
        self.assertIsNotNone(y)
        self.assertAlmostEqual(float(np.abs(y).max()), 0.7, delta=0.02)

    def test_gain_is_capped_for_a_nearly_dead_mic(self):
        y = voice.clean(np.concatenate([noise(0.5, 0.0002), tone(1, 0.01), noise(0.5, 0.0002, 3)]))
        self.assertIsNotNone(y)
        self.assertLessEqual(float(np.abs(y).max()), 0.01 * voice.MAX_GAIN * 1.01)
        self.assertLess(float(np.abs(y).max()), 0.7)

    def test_loud_voice_is_not_amplified_past_limit(self):
        y = voice.clean(np.concatenate([noise(0.5, 0.001), tone(1, 0.95), noise(0.5, 0.001, 3)]))
        self.assertLessEqual(float(np.abs(y).max()), 1.0)
        self.assertAlmostEqual(float(np.abs(y).max()), 0.7, delta=0.02)

    def test_continuous_speech_is_not_mistaken_for_noise(self):
        y = voice.clean(tone(3, 0.3))
        self.assertIsNotNone(y)
        self.assertGreater(len(y) / SR, 2.9)

    def test_rumble_is_filtered(self):
        t = np.arange(SR * 2) / SR
        rumble = 0.5 * np.sin(2 * np.pi * 20 * t)
        self.assertIsNone(voice.clean(rumble))


class WavTests(unittest.TestCase):
    def test_roundtrip_format(self):
        wav = voice.to_wav(tone(0.5, 0.5))
        with wave.open(io.BytesIO(wav)) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, SR))
            self.assertEqual(w.getnframes(), SR // 2)


class ApiTests(unittest.TestCase):
    def response(self, status=200, payload=None, text=""):
        r = mock.Mock(status_code=status, text=text)
        r.json.return_value = payload or {}
        return r

    def test_request_shape_and_parsing(self):
        session = mock.Mock()
        session.post.return_value = self.response(
            payload={"text": "  bonjour le monde ", "usage": {"seconds": 1.0, "cost": 0.000003}})
        wav = voice.to_wav(tone(1, 0.5))
        with mock.patch.object(voice, "LANGUAGE", "fr"), mock.patch.object(voice, "VOCAB", None):
            text, usage = voice.transcribe(wav, "sk-or-test", session)
        self.assertEqual(text, "bonjour le monde")
        self.assertEqual(usage["cost"], 0.000003)

        args, kwargs = session.post.call_args
        self.assertEqual(args[0], "https://openrouter.ai/api/v1/audio/transcriptions")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer sk-or-test")
        body = kwargs["json"]
        self.assertEqual(body["model"], "openai/whisper-large-v3-turbo")
        self.assertEqual(body["language"], "fr")
        self.assertEqual(body["input_audio"]["format"], "wav")
        self.assertEqual(base64.b64decode(body["input_audio"]["data"]), wav)  # raw base64, no data: URI
        self.assertNotIn("provider", body)

    def test_vocabulary_hint_goes_to_provider_options(self):
        session = mock.Mock()
        session.post.return_value = self.response(payload={"text": "ok"})
        with mock.patch.object(voice, "VOCAB", "Claude Code, OpenRouter"):
            voice.transcribe(b"x", "k", session)
        body = session.post.call_args.kwargs["json"]
        self.assertEqual(body["provider"]["options"]["groq"]["prompt"], "Claude Code, OpenRouter")

    def test_retries_server_errors_once(self):
        session = mock.Mock()
        session.post.side_effect = [self.response(502, text="bad gateway"),
                                    self.response(payload={"text": "ok"})]
        with mock.patch("voice.time.sleep"):
            text, _ = voice.transcribe(b"x", "k", session)
        self.assertEqual(text, "ok")
        self.assertEqual(session.post.call_count, 2)

    def test_client_error_is_not_retried(self):
        session = mock.Mock()
        session.post.return_value = self.response(401, text="invalid key")
        with self.assertRaisesRegex(RuntimeError, "401"):
            voice.transcribe(b"x", "k", session)
        self.assertEqual(session.post.call_count, 1)

    def test_process_skips_api_when_nobody_spoke(self):
        session = mock.Mock()
        self.assertIsNone(voice.process(np.zeros(SR), "k", session))
        session.post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
