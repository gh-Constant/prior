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

if ! command -v xcodebuild >/dev/null || ! xcodebuild -version >/dev/null 2>&1; then
  if [ "$require" = "1" ]; then
    die "xcodebuild is required to build the widgets (macOS + Xcode)"
  fi
  warn "xcodebuild not found or Xcode not active: skipping widgets (desktop app still works)"
  exit 0
fi

if [ -z "$team" ] && [ -n "$identity" ] && [ "$identity" != "-" ]; then
  team="$(team_id_from_identity "$identity")"
fi

if [ -z "$version" ]; then
  version="$(node -p "require('$repo_root/app/package.json').version")"
fi
info "building PriorWidgets $version into $app"

project="$repo_root/app/src-tauri/macos-widgets/PriorWidgets.xcodeproj"
[ -d "$project" ] || die "widget project not found: $project"

derived="$(mktemp -d "${TMPDIR:-/tmp}/prior-widgets.XXXXXX")"
tmp_dmg=""
cleanup() {
  local exit_status=$?
  rm -rf "$derived" ${tmp_dmg:+"$tmp_dmg"}
  exit $exit_status
}
trap cleanup EXIT INT TERM

xcode_cmd=(
  xcodebuild -project "$project"
  -scheme PriorWidgets
  -configuration Release
  -derivedDataPath "$derived"
  -destination "generic/platform=macOS"
  ARCHS="arm64 x86_64"
  ONLY_ACTIVE_ARCH=NO
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  MARKETING_VERSION="$version"
  CURRENT_PROJECT_VERSION=1
)

"${xcode_cmd[@]}" build

appex="$(find "$derived" -name '*.appex' | head -n 1)"
[ -n "$appex" ] || die "no .appex produced by xcodebuild"

plugins_dir="$app/Contents/PlugIns"
mkdir -p "$plugins_dir"
rm -rf "$plugins_dir/PriorWidgets.appex"
cp -R "$appex" "$plugins_dir/PriorWidgets.appex"

entitlements="$project/../PriorWidgets/PriorWidgets.entitlements"
info "signing embedded appex"
if [ -f "$entitlements" ]; then
  codesign --force --sign "$identity" --entitlements "$entitlements" --options runtime --timestamp "$plugins_dir/PriorWidgets.appex"
else
  codesign --force --sign "$identity" --preserve-metadata=entitlements --options runtime --timestamp "$plugins_dir/PriorWidgets.appex"
fi

info "re-sealing app bundle"
app_entitlements="$repo_root/app/src-tauri/entitlements.plist"
if [ -f "$app_entitlements" ]; then
  codesign --force --sign "$identity" --entitlements "$app_entitlements" --options runtime --timestamp "$app"
else
  codesign --force --sign "$identity" --options runtime --timestamp "$app"
fi
codesign --verify --deep --strict "$app"

bundle_dir="$(cd "$app/../.." && pwd)"

# Rebuild the dmg Tauri produced before the injection so it ships the widgets.
old_dmg="$(find "$bundle_dir/dmg" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -n 1 || true)"
if [ -n "$old_dmg" ]; then
  info "rebuilding dmg $old_dmg"
  tmp_dmg="$(mktemp "${TMPDIR:-/tmp}/prior.XXXXXX.dmg")"
  hdiutil create -volname "Prior" -srcfolder "$app" -ov -format UDZO "$tmp_dmg" >/dev/null
  mv -f "$tmp_dmg" "$old_dmg"
  tmp_dmg=""
  codesign --force --sign "$identity" --timestamp "$old_dmg"
  codesign --verify "$old_dmg"
fi

# Submit to Apple notarytool and staple tickets to .app and .dmg before packaging the updater
if [ "$identity" != "-" ]; then
  notarize_and_staple "$app" "$old_dmg"
fi

# Rebuild the updater tarball (same layout Tauri uses) and re-sign it.
# Because $app was stapled above, the updater tarball packages the stapled app.
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
