# Releases and deployment

The API deploys independently from the clients through Coolify. It is built from `server/Dockerfile`, runs migrations under a PostgreSQL advisory lock, serves `/health` and `/ready`, and runs as a non-root user. The checked-in Tauri Android project lives under `app/src-tauri/gen/android`; do not use a separate Android shell for releases.

Client releases use `vMAJOR.MINOR.PATCH` tags. GitHub Actions creates one GitHub Release, uploads macOS, Windows, Linux, and Android assets, publishes `latest.json`, and keeps the release page as the download destination. The web download page points to `https://github.com/gh-Constant/prior/releases/latest`.

The Tauri updater is configured for macOS, Windows, and Linux through that `latest.json`. It checks from the profile modal, installs the signed update, and relaunches macOS/Linux; Windows exits into the installer automatically. Add these secrets for signed artifacts: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`.

The Android signing key must be generated once and retained. Never generate a production key in CI. The release workflow fails when the Android signing secrets are absent, then signs the Tauri APK with the supplied keystore. The updater signing key must also never change after the first public release; losing it prevents existing desktop installations from accepting future updates.
