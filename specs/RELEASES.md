# Releases and deployment

The API deploys independently from the clients through Coolify. It is built from `server/Dockerfile`, runs migrations under a PostgreSQL advisory lock, serves `/health` and `/ready`, and runs as a non-root user. The checked-in Tauri Android project lives under `app/src-tauri/gen/android`; do not use a separate Android shell for releases.

Client releases use `vMAJOR.MINOR.PATCH` tags. GitHub Actions is prepared to build Tauri desktop bundles and an Android APK. Add these secrets only when releasing signed artifacts: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`.

The Android signing key must be generated once and retained. Never generate a production key in CI. The release workflow fails when the Android signing secrets are absent, then signs the Tauri APK with the supplied keystore. Desktop updater artifacts remain disabled until a Tauri updater public key is added to `app/src-tauri/tauri.conf.json` and the matching private key is stored in GitHub Actions.
