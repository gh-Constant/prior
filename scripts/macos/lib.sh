#!/usr/bin/env bash
# Shared helpers for the macOS signing scripts. Source this file; do not run it.

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

# Print the first "Developer ID Application" identity found in the given
# keychain (or the default search list). Only this kind of certificate passes
# Gatekeeper on other Macs: "Apple Development" and ad-hoc signatures trigger
# the "unidentified developer" warning.
find_developer_id_identity() {
  local keychain="${1:-}"
  security find-identity -v -p codesigning ${keychain:+"$keychain"} \
    | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' \
    | head -n 1
}

# Extract the 10-character team id from an identity such as
# "Developer ID Application: Tahar Touzi (XPB668GFX4)".
team_id_from_identity() {
  printf '%s' "$1" | sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p'
}

# Verify that an .app is signed with a Developer ID certificate, uses the
# hardened runtime, and (optionally) carries a stapled notarization ticket.
# Usage: verify_app_bundle <path.app> [require_notarization=1|0]
verify_app_bundle() {
  local app="$1" require_notarization="${2:-1}"
  [ -d "$app" ] || die "app bundle not found: $app"

  info "codesign --verify $app"
  codesign --verify --deep --strict --verbose=2 "$app"

  # Capture once: piping codesign into `grep -q` under pipefail reports SIGPIPE as a failure.
  local details authority
  details="$(codesign -dvv "$app" 2>&1)"
  authority="$(printf '%s\n' "$details" | sed -n 's/^Authority=\(Developer ID Application:.*\)$/\1/p' | head -n 1)"
  [ -n "$authority" ] || die "$app is not signed with a Developer ID Application certificate"
  info "signed by: $authority"

  case "$details" in
    *"flags="*"(runtime)"*|*"flags="*"runtime,"*|*"flags="*",runtime"*) ;;
    *) die "$app was signed without the hardened runtime; notarization will be rejected" ;;
  esac

  if [ "$require_notarization" = "1" ]; then
    info "stapler validate $app"
    xcrun stapler validate "$app"
    info "spctl --assess $app"
    spctl --assess --type execute --verbose=2 "$app"
  else
    warn "notarization check skipped for $app"
  fi
}

# Verify that a DMG is signed with a Developer ID certificate and optionally stapled.
verify_dmg() {
  local dmg="$1" require_notarization="${2:-1}"
  [ -f "$dmg" ] || die "dmg not found: $dmg"
  info "codesign --verify $dmg"
  codesign --verify --verbose=2 "$dmg"
  case "$(codesign -dvv "$dmg" 2>&1)" in
    *"Authority=Developer ID Application:"*) ;;
    *) die "$dmg is not signed with a Developer ID Application certificate" ;;
  esac
  if [ "$require_notarization" = "1" ]; then
    info "stapler validate $dmg"
    xcrun stapler validate "$dmg"
  fi
}

# Notarize and staple a macOS bundle (.app and optional .dmg).
# Reads credentials from:
#   NOTARY_APPLE_API_KEY, NOTARY_APPLE_API_ISSUER, NOTARY_APPLE_API_KEY_PATH (or APPLE_API_*)
# or
#   NOTARY_APPLE_ID, NOTARY_APPLE_PASSWORD, NOTARY_APPLE_TEAM_ID (or APPLE_*)
#
# Usage: notarize_and_staple <path.app> [path.dmg]
notarize_and_staple() {
  local app="$1"
  local dmg="${2:-}"

  local api_key="${NOTARY_APPLE_API_KEY:-${APPLE_API_KEY:-}}"
  local api_issuer="${NOTARY_APPLE_API_ISSUER:-${APPLE_API_ISSUER:-}}"
  local api_key_path="${NOTARY_APPLE_API_KEY_PATH:-${APPLE_API_KEY_PATH:-}}"
  local apple_id="${NOTARY_APPLE_ID:-${APPLE_ID:-}}"
  local apple_password="${NOTARY_APPLE_PASSWORD:-${APPLE_PASSWORD:-}}"
  local apple_team_id="${NOTARY_APPLE_TEAM_ID:-${APPLE_TEAM_ID:-}}"

  local auth_args=()
  if [ -n "$api_key" ] && [ -n "$api_issuer" ] && [ -n "$api_key_path" ]; then
    auth_args=(
      --key "$api_key_path"
      --key-id "$api_key"
      --issuer "$api_issuer"
    )
    info "notarizing using App Store Connect API key $api_key"
  elif [ -n "$apple_id" ] && [ -n "$apple_password" ]; then
    if [ -z "$apple_team_id" ]; then
      apple_team_id="$(team_id_from_identity "${APPLE_SIGNING_IDENTITY:-}")"
    fi
    auth_args=(
      --apple-id "$apple_id"
      --password "$apple_password"
      ${apple_team_id:+--team-id "$apple_team_id"}
    )
    info "notarizing using Apple ID $apple_id"
  else
    if [ "${MACOS_REQUIRE_NOTARIZATION:-1}" = "1" ]; then
      die "notarization credentials are missing but notarization is required"
    fi
    warn "no notarization credentials found; skipping notarization"
    return 0
  fi

  local target_to_submit=""
  local clean_target=0

  if [ -n "$dmg" ] && [ -f "$dmg" ]; then
    target_to_submit="$dmg"
    info "submitting dmg for notarization: $dmg"
  else
    target_to_submit="$(mktemp "${TMPDIR:-/tmp}/prior-notarize.XXXXXX.zip")"
    clean_target=1
    info "creating temporary zip for notarization: $target_to_submit"
    ditto -c -k --keepParent "$app" "$target_to_submit"
  fi

  info "submitting to Apple notarytool (waiting for response)..."
  local submit_output
  if ! submit_output="$(xcrun notarytool submit "$target_to_submit" "${auth_args[@]}" --wait 2>&1)"; then
    printf '%s\n' "$submit_output" >&2
    local submission_id
    submission_id="$(printf '%s\n' "$submit_output" | sed -n 's/^[[:space:]]*id:[[:space:]]*\([a-f0-9-]*\)/\1/p' | head -n 1)"
    if [ -n "$submission_id" ]; then
      info "fetching notarytool log for submission $submission_id"
      xcrun notarytool log "$submission_id" "${auth_args[@]}" >&2 || true
    fi
    [ "$clean_target" = "0" ] || rm -f "$target_to_submit"
    die "Apple notarytool rejected the submission"
  fi
  printf '%s\n' "$submit_output"
  [ "$clean_target" = "0" ] || rm -f "$target_to_submit"

  info "stapling ticket to $app"
  if ! xcrun stapler staple "$app"; then
    warn "stapling app directly after dmg submission failed; submitting app zip as fallback..."
    local app_zip
    app_zip="$(mktemp "${TMPDIR:-/tmp}/prior-app.XXXXXX.zip")"
    ditto -c -k --keepParent "$app" "$app_zip"
    xcrun notarytool submit "$app_zip" "${auth_args[@]}" --wait
    rm -f "$app_zip"
    xcrun stapler staple "$app"
  fi

  if [ -n "$dmg" ] && [ -f "$dmg" ]; then
    info "stapling ticket to $dmg"
    xcrun stapler staple "$dmg"
  fi

  info "notarization and stapling complete"
}
