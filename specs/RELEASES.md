# Releases and deployment

The API deploys independently from the clients through Coolify. It is built from `server/Dockerfile`, runs migrations under a PostgreSQL advisory lock, serves `/health` and `/ready`, and runs as a non-root user. The checked-in Tauri Android project lives under `app/src-tauri/gen/android`; do not use a separate Android shell for releases.

Client releases use `vMAJOR.MINOR.PATCH` tags. GitHub Actions creates one GitHub Release, uploads macOS, Windows, Linux, and Android assets, publishes `latest.json`, and keeps the release page as the download destination. The web download page points to `https://github.com/gh-Constant/prior/releases/latest`.

The Tauri updater is configured for macOS, Windows, and Linux through that `latest.json`. It checks from the profile modal, installs the signed update, and relaunches macOS/Linux; Windows exits into the installer automatically. Add these secrets for signed artifacts: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`.

The Android signing key must be generated once and retained. Never generate a production key in CI. The release workflow fails when the Android signing secrets are absent, then signs the Tauri APK with the supplied keystore. The updater signing key must also never change after the first public release; losing it prevents existing desktop installations from accepting future updates.

## macOS signing and notarization

A macOS build only opens without the Gatekeeper "unidentified developer" warning when it is signed with a **Developer ID Application** certificate (not "Apple Development", not ad-hoc) **and** notarized by Apple with the ticket stapled to the `.app`. The release workflow now enforces both for the `macos-latest` job:

- `Prepare macOS signing keychain` fails when `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` are missing, when the PKCS#12 contains no Developer ID identity, or when the notarization credentials (`APPLE_ID` + `APPLE_PASSWORD`, or `APPLE_API_KEY` + `APPLE_API_ISSUER` + `APPLE_API_KEY_BASE64`) are incomplete. `APPLE_TEAM_ID` is optional; it defaults to the team id in the certificate name.
- `Verify macOS signature and notarization` runs after `tauri-action` and rejects the release if the `.app` is not Developer ID signed, lacks the hardened runtime, has no stapled ticket, fails `spctl --assess`, or if the `.dmg` is unsigned.
- The repository variable `ALLOW_UNSIGNED_MACOS=true` is the only escape hatch; it restores the old ad-hoc behaviour and must never be set for a public release.

Set the secrets once from a Mac that holds the certificate and its private key:

```bash
scripts/macos/setup-github-secrets.sh
```

It exports the Developer ID identity (plus the Apple intermediate) as a password-protected PKCS#12, checks that it re-imports into a scratch keychain the same way CI does, validates the notarization credentials with `notarytool`, and writes the `APPLE_*` secrets with `gh secret set`. Pass `--p12 file.p12` to reuse an identity exported from Keychain Access. Prefer `--api-key AuthKey_<id>.p8 --api-issuer <uuid>` (an App Store Connect team key with the Developer role) over an Apple ID app-specific password: the key belongs to the team, so releases keep working regardless of who pushes the tag or whose Apple account changes. `--skip-certificate` re-configures notarization only.

Local signed builds use the same certificate from the login keychain:

```bash
scripts/macos/build-signed.sh            # aarch64, notarized if scripts/macos/signing.env has credentials
scripts/macos/build-signed.sh --universal --open
```

The script disables `createUpdaterArtifacts` when `TAURI_SIGNING_PRIVATE_KEY` is absent; never upload such a local build to a GitHub release.

## Google Play (Android)

Play is the primary Android channel; the GitHub APK stays for sideloading. The release workflow builds the APK **and** a signed AAB (`--apk --aab`), then the `play` job uploads the AAB to Google Play with `r0adkll/upload-google-play`. It is independent of the GitHub release job and is skipped with a warning when `PLAY_SERVICE_ACCOUNT_JSON` is missing.

One-time setup (manual, Play Console):

1. Create a Play developer account ($25). A new *personal* account must run a closed test with 12+ testers for 14 days before it can publish to production; an organization account (D-U-N-S) skips that.
2. Create the app `fr.constantsuchet.prior` and enrol in **Play App Signing**, using the existing release keystore as the upload key. Upload the first AAB by hand once; the API cannot create a new app.
3. Create a service account (Google Cloud → API access), grant it release permissions on the app in Play Console, and store its JSON key as the GitHub secret `PLAY_SERVICE_ACCOUNT_JSON`.
4. Optional repository variables: `PLAY_TRACK` (default `internal`; promote to production in Play Console) and `PLAY_RELEASE_STATUS` (default `completed`; use `draft` until the app's first review is done).

`versionCode` is derived by Tauri from the semantic version, so it increases with every tag.

### In-app updates

Play installs update through Play In-App Updates (`playUpdateCheck` / `playUpdateStart` in `PriorPlugin.kt`, `play_update_*` commands). Play re-signs the app, so a GitHub APK can never update a Play install; `androidUpdater.ts` therefore asks Play first and only falls back to the GitHub release flow when Play rejects the check (sideloaded or debug builds).

To force an update, set `MIN_ANDROID_VERSION` (e.g. `0.7.0`) on the API. `/health` then returns `minAndroidVersion`, and `ForcedUpdateGate` blocks Android apps older than it with an "Update now" screen that starts Play's immediate update. Unset means never force; offline or failed checks never block.
