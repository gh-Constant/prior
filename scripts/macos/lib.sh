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

# Verify that a DMG is signed with a Developer ID certificate.
verify_dmg() {
  local dmg="$1"
  [ -f "$dmg" ] || die "dmg not found: $dmg"
  info "codesign --verify $dmg"
  codesign --verify --verbose=2 "$dmg"
  case "$(codesign -dvv "$dmg" 2>&1)" in
    *"Authority=Developer ID Application:"*) ;;
    *) die "$dmg is not signed with a Developer ID Application certificate" ;;
  esac
}
