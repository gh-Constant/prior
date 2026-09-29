# Prior AI

Prior has three assistant providers, chosen in Settings → Assistant:

| Provider | Key | Where it runs |
|---|---|---|
| `hosted` (Prior AI, default) | Operator's `AI_API_KEY` in the API environment | `POST /v1/agent/complete` with `provider: "hosted"` |
| `openrouter` | The user's own OpenRouter key | Server proxy with the stored key, then client-direct fallback |
| `codex` | The user's ChatGPT session | Desktop only, through the Tauri Codex bridge |

A user whose settings predate Prior AI keeps `openrouter` only if they entered a key; everyone else moves to `hosted`. When a request uses the stored-key path and the user has no stored key, the API falls back to Prior AI.

## Use cases and models

Each completion declares a `purpose`, and the API maps it to its own model so they can change without a release:

| Purpose | Used by | Env | Default (2026-09-29 research) |
|---|---|---|---|
| `agent` | Assistant chat, create and update actions | `AI_MODEL_AGENT` | `z-ai/glm-5.3-flash` |
| `recommendations` | Today recommendations | `AI_MODEL_RECOMMENDATIONS` | `openai/gpt-6-luna` |
| `mail` | Mail to task | `AI_MODEL_MAIL` | `openai/gpt-6-luna` |
| `calendar` | Calendar event drafts | `AI_MODEL_CALENDAR` | `openai/gpt-6-luna` |

`AI_MODEL_FALLBACKS` is sent as OpenRouter's `models` list. `AI_REASONING_EFFORT_DRAFTS` (default `low`) applies to the three draft purposes; `AI_REASONING_EFFORT_AGENT` to chat. Dictation falls back to `AI_TRANSCRIPTION_*`, which default to the same key and `AI_BASE_URL/audio/transcriptions` when the user has no OpenAI key. `AI_BASE_URL` accepts any OpenAI-compatible endpoint.

## Cost guard

Hosted chat and dictation share a per-user daily cap, `AI_DAILY_REQUESTS_PER_USER` (default 300, UTC day, in memory). Hosted requests never enable paid web search. `GET /v1/agent/hosted` reports availability, the models, and today's usage.

## Updating existing tasks

The system prompt lists active tasks with their IDs and describes `update_task`. The model returns `taskUpdates: [{ taskId, changes, reasoning }]`. The client keeps only updates whose ID is in the task list it sent and whose fields actually change, shows them as review cards, and applies them through `localStore.updateTask` and the normal sync path after the user clicks Apply. Tasks cannot be deleted by the assistant.
