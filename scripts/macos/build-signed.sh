#!/usr/bin/env bash
# Build the macOS desktop app locally, signed with the Developer ID certificate from the
# keychain and (when notarization credentials are present) notarized + stapled, so the
# resulting .app/.dmg opens on any Mac without the Gatekeeper warning.
#
#   scripts/macos/build-signed.sh                 # aarch64 build, signed, notarized if creds exist
#   scripts/macos/build-signed.sh --universal     # universal (arm64 + x86_64) like the release workflow
#   scripts/macos/build-signed.sh --no-notarize   # sign only (local testing)
#   scripts/macos/build-signed.sh --open          # launch the built app when done
#
# Notarization credentials are read from the environment or from scripts/macos/signing.env
# (git-ignored, see signing.env.example): APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID.
# Set TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) to also produce updater artifacts; without
# it the build disables createUpdaterArtifacts, which is fine for a local build but such
# an artifact must never be uploaded to a GitHub release.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=lib.sh
. "$script_dir/lib.sh"

universal=0
notarize=1
open_app=0
while [ $# -gt 0 ]; do
  case "$1" in
    --universal) universal=1; shift ;;
    --no-notarize) notarize=0; shift ;;
    --open) open_app=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [ -f "$script_dir/signing.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$script_dir/signing.env"
  set +a
fi

command -v pnpm >/dev/null || die "pnpm is required (npm i -g pnpm@9.15.5)"

identity="${APPLE_SIGNING_IDENTITY:-$(find_developer_id_identity)}"
[ -n "$identity" ] || die "no 'Developer ID Application' identity in the keychain"
case "$identity" in
  "Developer ID Application:"*) ;;
  *) die "APPLE_SIGNING_IDENTITY must be a 'Developer ID Application' certificate, got '$identity'" ;;
esac
export APPLE_SIGNING_IDENTITY="$identity"
info "signing identity: $identity"

if [ "$notarize" = "1" ]; then
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ]; then
    export APPLE_TEAM_ID="${APPLE_TEAM_ID:-$(team_id_from_identity "$identity")}"
    info "notarizing as $APPLE_ID (team $APPLE_TEAM_ID)"
  elif [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    info "notarizing with App Store Connect API key $APPLE_API_KEY"
  else
    warn "no notarization credentials (APPLE_ID/APPLE_PASSWORD or APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH); building signed-only"
    notarize=0
  fi
fi
if [ "$notarize" = "0" ]; then
  # Tauri notarizes whenever these are set; make sure a stale shell export cannot leak in.
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
fi

build_args=()
target_dir="$repo_root/app/src-tauri/target"
if [ "$universal" = "1" ]; then
  rustup target add x86_64-apple-darwin aarch64-apple-darwin >/dev/null
  build_args+=(--target universal-apple-darwin)
  bundle_dir="$target_dir/universal-apple-darwin/release/bundle"
else
  bundle_dir="$target_dir/release/bundle"
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  warn "TAURI_SIGNING_PRIVATE_KEY is not set: updater artifacts are disabled for this local build"
  build_args+=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
fi

info "pnpm --dir app tauri build ${build_args[*]:-}"
pnpm --dir "$repo_root/app" tauri build ${build_args[@]+"${build_args[@]}"}

app_path="$(find "$bundle_dir/macos" -maxdepth 1 -name '*.app' | head -n 1)"
dmg_path="$(find "$bundle_dir/dmg" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -n 1 || true)"
[ -n "$app_path" ] || die "no .app produced under $bundle_dir/macos"

verify_app_bundle "$app_path" "$notarize"
[ -z "$dmg_path" ] || verify_dmg "$dmg_path"

info "app: $app_path"
[ -z "$dmg_path" ] || info "dmg: $dmg_path"
if [ "$notarize" = "0" ]; then
  warn "this build is signed but NOT notarized: Macs that download it will still see the Gatekeeper warning"
fi

[ "$open_app" = "0" ] || open "$app_path"
