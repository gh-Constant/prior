#!/usr/bin/env bash
# Build the PriorWidgets WidgetKit extension and embed it into a Tauri-built
# Prior.app, then re-seal the bundle and rebuild the distributables that
# Tauri produced before the injection (dmg + updater tarball + signature).
#
#   scripts/macos/embed-widgets.sh --app <Prior.app> --identity <id> [--team <team>] [--version <x.y.z>] [--require]
#
# --require fails when Xcode is missing (release builds); without it the
# script warns and leaves the .app untouched (local dev builds).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=lib.sh
. "$script_dir/lib.sh"

app=""
identity=""
team="${APPLE_TEAM_ID:-}"
version=""
require=0
while [ $# -gt 0 ]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --identity) identity="$2"; shift 2 ;;
    --team) team="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --require) require=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$app" ] || die "--app <Prior.app> is required"
[ -d "$app" ] || die "app bundle not found: $app"
[ -n "$identity" ] || die "--identity <Developer ID Application ...> is required"

if ! command -v xcodebuild >/dev/null; then
  if [ "$require" = "1" ]; then
    die "xcodebuild is required to build the widgets (macOS + Xcode)"
  fi
  warn "xcodebuild not found: skipping widgets (desktop app still works)"
  exit 0
fi

if [ -z "$version" ]; then
  version="$(node -p "require('$repo_root/app/package.json').version")"
fi
info "building PriorWidgets $version into $app"

project="$repo_root/app/src-tauri/macos-widgets/PriorWidgets.xcodeproj"
[ -d "$project" ] || die "widget project not found: $project"

derived="$(mktemp -d "${TMPDIR:-/tmp}/prior-widgets.XXXXXX")"
trap 'rm -rf "$derived"' EXIT

team_args=()
if [ -n "$team" ]; then
  team_args+=(DEVELOPMENT_TEAM="$team")
fi
xcodebuild -project "$project" \
  -target PriorWidgets \
  -configuration Release \
  -derivedDataPath "$derived" \
  -destination 'generic/platform=macOS' \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$identity" \
  "${team_args[@]}" \
  PROVISIONING_PROFILE_SPECIFIER= \
  MARKETING_VERSION="$version" \
  CURRENT_PROJECT_VERSION=1 \
  OTHER_CODE_SIGN_FLAGS="--options=runtime --timestamp" \
  build

appex="$(find "$derived/Build/Products/Release" -maxdepth 1 -name '*.appex' | head -n 1)"
[ -n "$appex" ] || die "no .appex produced by xcodebuild"

plugins_dir="$app/Contents/PlugIns"
mkdir -p "$plugins_dir"
rm -rf "$plugins_dir/PriorWidgets.appex"
cp -R "$appex" "$plugins_dir/PriorWidgets.appex"

info "signing embedded appex"
codesign --force --sign "$identity" --options runtime --timestamp "$plugins_dir/PriorWidgets.appex"

info "re-sealing app bundle"
codesign --force --sign "$identity" --options runtime --timestamp "$app"
codesign --verify --deep --strict "$app"

bundle_dir="$(cd "$app/../.." && pwd)"

# Rebuild the dmg Tauri produced before the injection so it ships the widgets.
old_dmg="$(find "$bundle_dir/dmg" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -n 1 || true)"
if [ -n "$old_dmg" ]; then
  info "rebuilding dmg $old_dmg"
  tmp_dmg="$(mktemp "${TMPDIR:-/tmp}/prior.XXXXXX.dmg")"
  trap 'rm -rf "$derived" "$tmp_dmg"' EXIT
  hdiutil create -volname "Prior" -srcfolder "$app" -ov -format UDZO "$tmp_dmg" >/dev/null
  mv -f "$tmp_dmg" "$old_dmg"
  codesign --force --sign "$identity" "$old_dmg"
  codesign --verify "$old_dmg"
fi

# Rebuild the updater tarball (same layout Tauri uses) and re-sign it.
old_tar="$(find "$bundle_dir/macos" -maxdepth 1 -name '*.app.tar.gz' 2>/dev/null | head -n 1 || true)"
if [ -n "$old_tar" ]; then
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    warn "TAURI_SIGNING_PRIVATE_KEY is not set: updater tarball keeps the pre-widget build"
  else
    info "rebuilding updater tarball $old_tar"
    (cd "$(dirname "$app")" && COPYFILE_DISABLE=1 tar -czf "$old_tar" "$(basename "$app")")
    rm -f "$old_tar.sig"
    (cd "$repo_root/app" && pnpm tauri signer sign "$old_tar")
    [ -f "$old_tar.sig" ] || die "signer did not produce $old_tar.sig"
  fi
fi

info "widgets embedded: $plugins_dir/PriorWidgets.appex"
