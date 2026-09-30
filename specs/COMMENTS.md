# Task comments and @mentions

Members of a shared project can discuss a task in a comment thread. Personal (unshared) tasks have no comments.

## Data

Migration `030_task_comments.sql`:

- `task_comments`: `id` (client-generated UUID, so a retried post is idempotent), `task_id`, `project_id`, `author_id` (`NULL` once the author deleted their account), `body` (1–4000 characters, plain text), `mentions` (JSONB array of user ids), `created_at`, `edited_at`, `deleted_at` (soft delete).
- `comment_mentions`: one row per mentioned user and comment, with `read_at`. It feeds the in-app mention list and unread count.

Comments are collaboration records, like invites and project members: they are not a task field, so they do not travel through `Store.Push`, the task change log, SQLite, localStorage, MCP or the assistant tools. They are only available online, from the API, for tasks of shared projects.

## Permissions

The server resolves the caller from the session and checks project membership on every call (`commentScopeTx`); the task must belong to the project.

| Action | Who |
| --- | --- |
| Read a thread | Any active member (owner, editor, viewer). Reading marks the reader's mentions in it as read. |
| Post | Owner and editors. Viewers get 403 (`ErrProjectReadOnly`). |
| Edit | The author, while they still have write access. Sets `edited_at`. |
| Delete | The author (with write access), or the project owner (moderation). Soft delete. |

Mentions are validated on the server (`validMentionsTx`): only active members of the project are kept and the author is dropped, so a client cannot notify outsiders. Editing a comment only notifies people who were not mentioned before.

## API

All routes need a session and share the per-user `settingsLimiter` (rate-limited).

- `GET /v1/collaboration/projects/{projectID}/tasks/{taskID}/comments` → `{comments}` oldest first.
- `POST …/comments` `{id?, body, mentions?}` → 201 with the comment.
- `PATCH …/comments/{commentID}` `{body, mentions?}` → the comment.
- `DELETE …/comments/{commentID}` → 204.
- `GET /v1/collaboration/mentions` → `{mentions, unread}`, newest 50, only in projects the user still belongs to. Each mention has the comment id, task id and title, project id and name, author name, a 160-character excerpt and dates.
- `POST /v1/collaboration/mentions/read` `{commentIds}` (at most 200; empty marks all) → 204.

## Realtime

Writes publish over `/v1/realtime` (hub + `pg_notify`):

- `comments_required` to every project member: open threads re-fetch.
- `mentions_required` to newly mentioned people (and to the reader after `mentions/read`, so their other devices update the count).

Neither event triggers a full sync. The client re-dispatches realtime messages as the `prior-realtime` window event (`REALTIME_EVENT`).

## Client

- `app/src/lib/comments.ts`: pure helpers. `mentionQuery` finds the `@query` before the caret, `filterMentionables` ranks members, `insertMention` inserts `@Display Name `, `extractMentions` returns the ids of members named in the text, `commentParts` splits a body into text, mention and link parts (only `http`/`https` URLs become links; everything is rendered as text, never HTML), `relativeTime` and `newMentionsToNotify`.
- `components/collaboration/TaskComments.tsx`: `SharedTaskComments` renders the thread in the task detail panel and in the composer (editing an existing task), only when the task's project is shared. The editor is a textarea with the combobox role and a mention listbox (↑/↓, Enter/Tab to pick, Esc to close); ⌘/Ctrl+Enter posts. Comments show avatar, name ("Deleted user" when anonymized), relative time with the full date as a tooltip, and "edited".
- `components/collaboration/MentionNotifications.tsx`: the three newest unread mentions as toasts (open, mark as read, mark all as read). `App` loads mentions after sync and on `mentions_required`, and shows one local notification per new mention (`notificationScheduler.notifyNow`, see `REMINDERS.md`); opening a mention opens the task and marks it read.

## Account deletion and export

Deleting an account keeps its comments in their threads as "Deleted user" (`author_id = NULL`) and removes the user from every `mentions` array and from `comment_mentions`. The data export contains the user's own comments in `comments.json` (see `ACCOUNT.md`).
