# Account lifecycle and compliance

Account deletion (Google Play, GDPR erasure), data export (GDPR access and portability), password reset, email verification and two-factor authentication. Authentication itself is in `AUTH.md`.

## Account deletion

`DELETE /v1/me {email, password?, code?, recoveryCode?}` (rate-limited per token, `accountLimiter`).

Re-authentication:

- `email` must match the account (case-insensitive), as typed in the confirmation dialog.
- Password accounts send the current password. A wrong one is `403 INVALID_PASSWORD` (never 401, which the client treats as an expired session).
- Google-only accounts need a session created less than 10 minutes ago; otherwise `403 REAUTH_REQUIRED` and the client asks the user to sign out and in again.
- Accounts with 2FA also send a TOTP code or a recovery code (`403 TWO_FACTOR_REQUIRED`, `400 INVALID_CODE`).

Then, in this order:

1. **Stripe.** An active subscription is canceled immediately (`DELETE /v1/subscriptions/{id}`, `billing.Stripe.CancelSubscriptionNow`). If Stripe fails, nothing is deleted: `502 BILLING_CANCEL_FAILED`.
2. **One PostgreSQL transaction** (`store.DeleteAccount`, under the push advisory lock so no sync mutation interleaves):
   - Every project the user owns goes to the oldest remaining active editor, else the oldest member of any role (ties by user id). The new owner's membership becomes `owner`, the project loses its area (the area was the old owner's) and gets a new workspace revision. A project with no other member is deleted.
   - The user's tasks in projects other people keep move to the project owner, with their change-log rows, so the team's board and history survive. Change-log rows the user wrote on a teammate's task are attributed to the task owner.
   - The user id is removed from `people_ids` (tasks and change log); invites sent to the user's email are dropped; task comments are anonymized to "Deleted user" (`author_id = NULL`).
   - The `users` row is deleted. Existing `ON DELETE CASCADE` foreign keys remove tasks, habits, notes and attachments, areas and folders, agent chats, settings, account documents, sessions and MCP keys, mail and calendar accounts, subscriptions, memberships and invites sent, auth tokens, recovery codes, sign-in challenges, and all game data (profile, XP ledger, achievements, inventory, chests, events, league membership, kudos, project leaderboard opt-ins). `billing_payments` keeps its accounting row with `user_id = NULL`.
3. **After commit:** live sockets close (`4401`), the new owners get `workspace_required`, every former teammate gets `collaboration_required` and `tasks_required`, and the Gmail and Google Calendar refresh tokens are revoked at Google, best effort.

`TestDeleteAccountTransfersAndLeavesNoRowsPostgres` walks every foreign key to `users` (from the catalog, so new tables are covered automatically) and the `people_ids` lists, and asserts that nothing references the deleted id.

Client: Settings → Profile & account → **Danger zone** opens `DeleteAccountDialog` (type the email; the password for password accounts; the 2FA code when on; an "Export your data first" shortcut). On success it dispatches `prior-account-deleted`; `App` closes realtime, runs `wipeAccountLocalData` (SQLite rows of the account, every `*.account.v2.<id>` localStorage collection including the game cache, cached attachments in IndexedDB, device UI keys such as open note tabs), clears the keychain session and returns to the sign-in screen.

The public page `site/delete-account.html` (linked from the site footer and the privacy page) explains the steps for the Play Store's "delete account" URL: `https://prior.constantsuchet.fr/delete-account.html`.

## Data export

`GET /v1/me/export` (rate-limited per token) streams `prior-export-YYYY-MM-DD.zip`:

| File | Content |
| --- | --- |
| `README.txt` | What is inside and what is never exported |
| `profile.json` | id, email, display name, avatar URL, locale, verification date, 2FA on/off, Google linked, dates |
| `tasks.json`, `tasks.csv` | The user's tasks and tasks of projects they belong to; CSV cells starting with `= + - @` are prefixed with `'` (formula injection) |
| `habits.json`, `areas.json` | |
| `projects.json` | Personal projects, and shared projects with members as `{userId, displayName, role}` only |
| `notes.json`, `attachments/` | Folders, notes, attachment metadata and files (`<id>-<name>`, path separators removed) |
| `settings.json` | Assistant settings as booleans (`hasOpenRouterKey`…) and account documents with credential-like fields removed (`ScrubSecrets`) |
| `assistant-chats.json`, `game.json` | Chats with messages; game profile, achievements, inventory, chests |
| `comments.json` | Comments the user wrote on shared-project tasks (id, task id and title, project id, body, dates) |

Password hashes, sessions, MCP keys, API keys, OAuth tokens and TOTP secrets are never read.

Signed-out or local-only users export from the device: Settings → Profile & account → "Export the data on this device" downloads `prior-local-export-YYYY-MM-DD.json` (`buildLocalExport`: tasks, habits, areas, projects, folders, notes).

## Email

`server/internal/mailer`: a `Sender` interface with `ResendSender` (`POST https://api.resend.com/emails`), `LogSender` (development: logs the link) and a disabled sender (production without a key: logs a warning, never the link or token). Messages are rendered by `mailer.Render` in en, fr, de, es and pt (Brazilian), as HTML (inline styles, `color-scheme: light dark`, a dark-mode media query, the coral `#f35f43` button) plus plain text.

Environment: `RESEND_API_KEY`, `EMAIL_FROM` (default `Prior <no-reply@prior.constantsuchet.fr>`), `WEB_APP_URL` (default `https://app.prior.constantsuchet.fr`, base of emailed links). The sending domain must be verified in Resend (SPF/DKIM DNS records).

The email language comes from the client (`language` on register, login, forgot and resend) and is stored in `users.locale`.

## Password reset

- `POST /v1/auth/password/forgot {email, language}` always answers `202`; the lookup and the email run after the response, so neither the status nor the timing reveals whether an account exists. Auth rate limit per IP, plus at most one email a minute and five an hour per account.
- Tokens: 32 random bytes, only the SHA-256 is stored (`auth_tokens`), single-use, 30 minutes; issuing a new one invalidates the previous.
- `POST /v1/auth/password/reset {token, password}` sets the password, revokes every session (MCP keys included) and pending 2FA challenge, closes live sockets, and marks the email verified (the link proved the address). 2FA still applies at the next sign-in.
- Client: "Forgot password?" in `SignInPanel` (`ForgotPasswordForm`); the emailed link opens `/reset-password?token=` on the web app (`AccountLinkPage`), which offers "Sign in" and "Open the Prior app" (`prior://auth`).

## Email verification

- `users.email_verified_at` (migration `028_account_security.sql`). Google sign-ins set it (Google verified the address); existing Google accounts are backfilled. `GET /v1/me` reports `emailVerified` from it.
- Registration sends a verification email (24 h token, hashed, single-use); `POST /v1/auth/email/verify/resend` sends another (one a minute, five an hour). `POST /v1/auth/email/verify {token}` only verifies the address the token was sent to.
- Client: `/verify-email?token=` (`AccountLinkPage`); a dismissible `VerifyEmailBanner` for unverified password accounts; the status and a resend button in Settings → Profile & account.
- Changing the email is not supported yet. When it is, the new address must go through the same verification before it replaces the old one.

## Two-factor authentication

See `AUTH.md` → Two-factor authentication.
