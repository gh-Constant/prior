# Prior

Prior is a deliberately small personal task app. Create tasks quickly, then sort them by importance and urgency. It is local-first and designed to grow only when the product earns it.

## Repository layout

- `app/` — React + TypeScript + Vite client, with a Tauri 2 shell and SQLite migration.
- `app/Dockerfile` — static browser build for `app.prior.constantsuchet.fr`.
- `app/src-tauri/gen/android/` — generated Tauri Android project with the native App Link, Keystore-backed session storage, and Glance widget.
- `server/` — Go API, PostgreSQL migrations, password/Google authentication, sessions, and revision-based sync.
- `site/` — minimal public pages for `prior.constantsuchet.fr`, including privacy and terms pages.
- `specs/` — architecture and product decisions that describe the implementation.

## Development

Requirements: Node 20+, pnpm 9+, Go 1.27+, Rust, and Docker.

```bash
cp .env.example .env
docker compose up -d postgres
set -a && source .env && set +a
cd server && go run ./cmd/migrate && go run ./cmd/prior
```

In another terminal:

```bash
pnpm install
pnpm --dir app dev
```

The browser client works without the API using a local fallback store. Tauri development uses the same React UI with the SQLite and native integration configured in `app/src-tauri`.

Android requires JDK 17, Android SDK Platform 36, Build Tools 35, NDK 27.1.12297006, and Rust's `aarch64-linux-android` target. Initialize once with `pnpm --dir app tauri android init`, then build with `pnpm --dir app tauri android build --debug --target aarch64 --apk`.

## Authentication

Email/password accounts are available directly in the app. Passwords are stored as bcrypt hashes and sessions are returned as bearer tokens. Google OAuth remains optional: create a Google Cloud OAuth client for a web application, add the exact redirect URI from `GOOGLE_REDIRECT_URL`, configure the consent screen with the verified `prior.constantsuchet.fr` domain, and keep the client secret only in the API environment. Prior requests only `openid email profile`. See [specs/AUTH.md](specs/AUTH.md).

Voice transcription is handled by the API with a per-user OpenAI key configured in Settings → Assistant. The key is stored with that user's assistant settings and encrypted at rest when `SETTINGS_ENCRYPTION_KEY` is configured; it is never logged or shared with another account. The authenticated client uploads a short `webm`/`mp4` recording to `POST /transcribe`, which forwards it to OpenAI's `gpt-4o-mini-transcribe` model.

## Coolify

Create a private PostgreSQL resource and three Docker applications pointed at this repository: `server/Dockerfile` on port `8080` for the API, `app/Dockerfile` on port `80` with build arg `VITE_API_URL=https://api.prior.constantsuchet.fr` for the browser client, and `site/Dockerfile` on port `80` for the public/legal site. Use `/health` for each health check, keep PostgreSQL private, and enable scheduled backups. Configure API variables from `.env.example`. See [specs/RELEASES.md](specs/RELEASES.md).

Suggested DNS:

- `prior.constantsuchet.fr` → public static site / legal pages
- `api.prior.constantsuchet.fr` → Go API
- `app.prior.constantsuchet.fr` → optional HTTPS Android App Link fallback

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
cd server && gofmt -w . && go vet ./... && go test ./... && go build ./cmd/prior
```

## Releases

Production client releases are tag-driven:

```bash
git tag v0.1.2
git push origin v0.1.2
```

Create a `vMAJOR.MINOR.PATCH` tag to build the desktop and Android installers into a GitHub Release. Downloads are available from [the latest release](https://github.com/gh-Constant/prior/releases/latest), and signed desktop builds use the Tauri updater manifest. See `.github/workflows/release.yml` and [specs/RELEASES.md](specs/RELEASES.md) for required secrets.
