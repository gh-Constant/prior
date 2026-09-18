# Prior agent instructions

This file is the project handoff for coding agents. Read it before changing the repository. Keep changes focused, preserve unrelated user work, and do not commit secrets.

## What Prior is

Prior is a local-first task and habit app with an optional account sync service.

- `app/` is the React 19 + TypeScript + Vite client.
- `app/src-tauri/` is the Tauri 2 desktop/mobile shell, native commands, SQLite migrations, updater configuration, and Android project.
- `server/` is the Go API with PostgreSQL migrations, authentication, sessions, sync, and agent-chat storage.
- `site/` contains the public/legal website.
- `specs/` contains product and architecture decisions.

The React UI is shared by browser, macOS, Windows, Linux, and Android. Browser storage uses localStorage when Tauri is unavailable; native builds use the Tauri SQLite database. Do not create separate business logic for each platform unless the platform API requires it.

Task data includes a title, optional description, optional ISO due date, Todoist-style priority 1–4, importance, urgency, completion state, and timestamps. Keep these fields in sync across `app/src/types.ts`, local SQLite/localStorage, PostgreSQL, sync mutations, and task-change snapshots. Existing data may omit the newer optional fields; normalize it to an empty description, no due date, and priority 4.

The in-app AI assistant is a client-side OpenRouter integration. Its system prompt describes Prior's real capabilities: `list_tasks`, `list_habits`, `create_task`, `create_habit`, and `prioritize_tasks`. Create actions are returned as review cards and only persist after the user confirms them. Chat history is stored in PostgreSQL; OpenRouter API settings remain in local storage and must never be logged or committed.

## Working rules

- Treat the repository as the source of truth.
- Inspect existing code and `git status` before editing. Keep unrelated changes intact.
- Use `rg`/`rg --files` for searches.
- Use `apply_patch` for intentional file edits.
- Keep UI components state-driven and focused. Put API/database logic in `app/src/lib`, `server/internal/httpapi`, or `server/internal/store` as appropriate.
- Add or update tests for behavior changes unless the user explicitly asks not to run tests. At minimum, run the smallest relevant check before reporting completion.
- Never put API keys, OAuth secrets, signing keys, keystores, passwords, or production environment values in source control.
- Do not edit `app/src-tauri/target`, `app/dist`, or other build output. The checked-in Android project under `app/src-tauri/gen/android` contains project-specific native code; preserve custom Kotlin and manifest changes when regenerating it.

## Local development

Requirements depend on the target: Node 20+, pnpm 9.15.5, Go 1.27+, Rust, Docker; Android additionally needs JDK 17, Android SDK Platform 36, Build Tools 35, NDK 27.1.12297006, and the `aarch64-linux-android` Rust target.

Typical browser/API setup:

```bash
docker compose up -d postgres
set -a && source .env && set +a
cd server && go run ./cmd/migrate && go run ./cmd/prior
```

In another terminal:

```bash
pnpm install
pnpm --dir app dev
```

Useful checks:

```bash
pnpm typecheck
pnpm test
pnpm build
cd server && gofmt -l . && go vet ./... && go test ./... && go build ./cmd/prior
```

For native development:

```bash
pnpm --dir app tauri dev
```

For Android, after the generated project has been initialized:

```bash
pnpm --dir app tauri android build --debug --target aarch64 --apk
```

If a macOS native app opens a blank window and immediately disappears, run `pnpm --dir app tauri dev` and read the Rust panic. Tauri errors are often fatal before the webview is created.

## URLs and authentication

Production hosts:

- Browser app: `https://app.prior.constantsuchet.fr`
- API: `https://api.prior.constantsuchet.fr`
- Public site: `https://prior.constantsuchet.fr`

`app/src/lib/api.ts` intentionally uses `http://localhost:8080` only for browser development. Native builds default to `https://api.prior.constantsuchet.fr` because release builds do not receive Coolify's `VITE_API_URL` build argument. Do not make a native release depend on localhost.

Google OAuth is handled by the API. The desktop return URL is `prior://auth/callback`; the browser return URL is the current web origin's `/auth/callback`. Keep the Google client secret only in Coolify/API environment variables. Password authentication is also supported and should remain functional.

## Tauri updater

Desktop updater configuration lives in `app/src-tauri/tauri.conf.json` and `app/src/lib/updater.ts`.

- The updater endpoint is `https://github.com/gh-Constant/prior/releases/latest/download/latest.json`.
- The public updater key is checked into `tauri.conf.json`; never replace it after a public release.
- The updater is desktop-only and currently checks when the user opens Profile → Account. It is not a silent background check on app startup.
- The user explicitly clicks the available update button. macOS/Linux download, install, and relaunch; Windows uses the configured passive installer flow.
- A release must contain signed artifacts and `latest.json`; an empty or draft GitHub release cannot serve updates.

The Tauri opener plugin currently accepts `requireLiteralLeadingDot`. Do not reintroduce the old `plugins.opener.open` field: it causes a native startup panic with the installed plugin version.

## Client release procedure

Client releases are tag-driven by `.github/workflows/release.yml`. Before creating a release, update the same semantic version in all four locations:

- `app/package.json`
- `app/src-tauri/tauri.conf.json`
- `app/src-tauri/Cargo.toml`
- the `prior` package entry in `app/src-tauri/Cargo.lock`

Then commit, push `main`, and create the matching tag:

```bash
git tag vMAJOR.MINOR.PATCH
git push origin vMAJOR.MINOR.PATCH
```

The workflow builds macOS universal, Windows, Linux, and Android artifacts, signs the desktop updater assets, uploads `latest.json`, and publishes the release after all jobs succeed. Verify the GitHub Actions run and that the release is no longer a draft before telling the user the update is available. Do not manually upload unsigned installers or create a tag that does not match the app version.

Required GitHub Actions secrets include `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, the Apple signing secrets, Windows certificate secrets, and the Android keystore secrets. The production Android keystore and Tauri updater signing key must be retained permanently.

The macOS job refuses to build without a Developer ID certificate and notarization credentials, and verifies the produced `.app`/`.dmg` with `codesign`, `stapler`, and `spctl` before the release is published; this is what keeps the Gatekeeper warning away. Configure the `APPLE_*` secrets with `scripts/macos/setup-github-secrets.sh`, build a signed app locally with `scripts/macos/build-signed.sh`, and never set the `ALLOW_UNSIGNED_MACOS` repository variable for a public release. See `specs/RELEASES.md`.

## Coolify and server deployment

Coolify deploys the API from `server/Dockerfile` on port `8080` and the browser app from `app/Dockerfile` on port `80`. The app container needs the build argument:

```text
VITE_API_URL=https://api.prior.constantsuchet.fr
```

The API runs PostgreSQL migrations under an advisory lock during startup. Keep PostgreSQL private and use `/health` for container health checks. A push to `main` only auto-deploys if Coolify's repository webhook or polling/deploy setting is configured; GitHub Actions client releases are independent of Coolify.

When adding a server migration, create the next numbered SQL file under `server/internal/database/migrations/` and verify the migration command against the intended database. Never reset or drop production data to solve a deployment issue.

## Handoff checklist

Before finishing a code task:

1. Explain the root cause or implementation outcome.
2. Run the relevant checks, or state clearly when the user asked not to run them or the environment lacks a required tool.
3. Check `git diff --check` and `git status`.
4. Commit only the intended files with a clear message.
5. Push only when the user requested delivery or it is part of the established release/deployment task.
6. For releases, verify the workflow result and published assets instead of assuming a pushed tag succeeded.
