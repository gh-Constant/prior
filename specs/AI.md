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
| `recommendations` | Today recommendations | `AI_MODEL_DECISIONS`, then `AI_MODEL_RECOMMENDATIONS` if it fails | `typesafe/jev-1.13`, then `openai/gpt-6-luna` |
| `mail` | Mail to task | `AI_MODEL_MAIL` | `openai/gpt-6-luna` |
| `calendar` | Calendar event drafts | `AI_MODEL_CALENDAR` | `openai/gpt-6-luna` |
| `import` | AI mode of Settings → Import (`IMPORT.md`), Pro only | `AI_MODEL_IMPORT`, then `AI_MODEL_MAIL` | the mail model |

`AI_MODEL_FALLBACKS` is sent as OpenRouter's `models` list. `AI_REASONING_EFFORT_DRAFTS` (default `low`) applies to the three draft purposes; `AI_REASONING_EFFORT_AGENT` to chat. Dictation falls back to `AI_TRANSCRIPTION_*`, which default to the same key and `AI_BASE_URL/audio/transcriptions` when the user has no OpenAI key. `AI_BASE_URL` accepts any OpenAI-compatible endpoint.

## Decision model (Jev, 2026-09-30)

Jev (TypeSafe, `typesafe/jev-1.13` on OpenRouter) does not write text: it reads a state and answers typed questions — `score` (a position on ordered levels), `choice` (one option of a set) or `noul` (probability of yes). It costs about $0.04 per million input tokens (output is free) and answers in 70–500 ms, roughly 100× cheaper and faster than a chat model. Prior uses it wherever a feature only has to pick or rank; everything the user reads stays written by code or by a chat model.

- **Today recommendations** (hosted only). `agentComplete` sends `purpose: "recommendations"` to `jevTodayRecommendations` (`server/internal/httpapi/today_decisions.go`) before any chat model. Code drops waiting/done tasks and tasks planned for a later day, and turns dates into words ("overdue by 2 days", "planned for today at 14:30"), since Jev is unreliable at date arithmetic. One call asks one 5-level `score` question per task ("how much should the user focus on this task today?"). Tasks under 1.5 are left out, near ties (< 0.1) go to the earlier deadline, then the higher priority, and at most three are kept. Code writes the reasons (the two most telling facts), the summary, the tips and the start times (a task planned at a time keeps it; the first other one takes the client's next free slot) in the user's language (`today_copy.go`). The answer has the chat model's JSON shape, so clients need no change. A decision error, an unreadable prompt or an empty answer falls back to `AI_MODEL_RECOMMENDATIONS`; no open task means no call at all.
- **Not moved**: assistant chat, mail to task and calendar drafts must write text (titles, descriptions, replies), which Jev cannot do.

`AI_DECISIONS_URL` defaults to `https://openrouter.ai/api/alpha/decisions` when `AI_BASE_URL` is OpenRouter (same `AI_API_KEY`); `off` in `AI_DECISIONS_URL` or `AI_MODEL_DECISIONS` turns decisions off. Keep the model pinned: the 1.5 threshold is calibrated on its scores, and `~typesafe/jev-latest` moves. Usage and cost are recorded under the `recommendations` purpose.

## Who gets Prior AI

Prior AI is for paying users. Every hosted completion and transcription goes through one function, `hostedAIEntitlement` in `server/internal/httpapi/entitlement.go`, which returns whether the user is allowed and their plan quotas (`AgentTokensPerMonth`, 0 = unlimited). Paid plans plug in there. Until they exist, only the emails in `AI_HOSTED_ALLOWED_EMAILS` have access. Refusals return `402` with code `HOSTED_AI_REQUIRES_PLAN`, and quota refusals `429` with `HOSTED_AI_QUOTA`. Users without access can still pick their own OpenRouter key or Codex.

The `import` purpose is the exception: it is Pro-only by design. `resolveCompletionRoute` always routes it to Prior AI, even when the request does not say `provider: "hosted"` and the user has stored an OpenRouter key, so only `hostedAIEntitlement.Allowed` accounts (Pro, Team, Enterprise, staff) can use AI import and everyone else gets `402 HOSTED_AI_REQUIRES_PLAN`. It is not token-capped, counts toward the daily request backstop and is recorded under its own purpose in `hosted_ai_usage`. See `IMPORT.md`.

## Cost guard

- Recommendations, mail, calendar, import and dictation are not token-capped; assistant chat is capped per month by the plan, from the tokens OpenRouter reports.
- Usage is persisted per user, day and purpose in `hosted_ai_usage` (requests and tokens).
- `AI_DAILY_REQUESTS_PER_USER` (default 300, in memory) is an abuse backstop on all hosted requests.
- Hosted requests never enable paid web search.
- Today recommendations are cached per account and only regenerated when the plan changes (day, language, model, active tasks' planning fields, today's calendar), at most every 10 minutes, or when the user presses refresh. Time passing alone never triggers a call.

`GET /v1/agent/hosted` reports availability, the entitlement, the models, and today's usage.

## Updating existing tasks

The system prompt lists active tasks with their IDs and describes `update_task`. The model returns `taskUpdates: [{ taskId, changes, reasoning }]`. The client keeps only updates whose ID is in the task list it sent and whose fields actually change, shows them as review cards, and applies them through `localStore.updateTask` and the normal sync path after the user clicks Apply. Tasks cannot be deleted by the assistant. `create_task` and `update_task` also carry `checklist` and `reminderAt` (see `CHECKLISTS.md` and `REMINDERS.md`); review cards show the checklist and the reminder before anything is saved.

## Changing projects, habits, notes and areas (0.9)

The prompt now lists every area, project, habit and note with its `[id: ...]`, the members and milestones of shared projects, tasks' assignee, parent, milestone and blockers, the tasks completed in the last 14 days, and the calendar events of the next 7 days (read-only, from the local calendar state). Besides `taskUpdates`, the model returns `updates: [{ kind, targetId, changes, reasoning }]` for `update_project` (name, description, status, health, dates, type, icon, `addMilestones`), `update_habit` (title, schedule, end date, flags, `checkInToday`), `update_note` (title, `bodyMarkdown` or `appendMarkdown`, favorite) and `update_area` (name, icon). `buildProposedEntityUpdate` drops unknown ids and no-op fields; the cards are stored in `agent_chat_messages.proposed_updates` (migration `032`) and applied by `App.applyAgentEntityUpdates` only after the user confirms. Nothing can be deleted.

The assistant's look (mascot, moods, thinking row) and the review panel that presents every proposal (diffs, inline edit, Apply all, collapsed summary) are described in `DESIGN.md`, "Assistant identity".

New and updated tasks accept `assignee` (a member of the task's shared project, by name or email; anyone else stays a free-text `assigneeName`), `milestone` (by name), `parentTaskId` / `parentTitle` (sub-tasks, including a parent created in the same answer) and `blockedBy` (existing task ids). All are resolved against the user's data before a card is shown.
