#!/bin/sh
# Guards the client release versions: app/package.json, tauri.conf.json,
# Cargo.toml and the `prior` entry in Cargo.lock must all carry the same
# 0.3.x version before a tag can be published.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PKG="$ROOT/app/package.json"
TAURI="$ROOT/app/src-tauri/tauri.conf.json"
CARGO="$ROOT/app/src-tauri/Cargo.toml"
LOCK="$ROOT/app/src-tauri/Cargo.lock"

for file in "$PKG" "$TAURI" "$CARGO" "$LOCK"; do
  [ -f "$file" ] || { echo "check-versions: missing $file" >&2; exit 1; }
done

pkg_version="$(node -p "require('$PKG').version")"
tauri_version="$(node -p "require('$TAURI').version")"
cargo_version="$(sed -n 's/^version = "\(.*\)"/\1/p' "$CARGO" | head -n 1)"
lock_version="$(awk '/^name = "prior"$/{found=1} found && /^version = /{gsub(/"|version = | /,""); print; exit}' "$LOCK")"

echo "package.json:  $pkg_version"
echo "tauri.conf:    $tauri_version"
echo "Cargo.toml:    $cargo_version"
echo "Cargo.lock:    $lock_version"

for version in "$pkg_version" "$tauri_version" "$cargo_version" "$lock_version"; do
  case "$version" in
    0.3.*) ;;
    *) echo "check-versions: version '$version' is not 0.3.x" >&2; exit 1 ;;
  esac
done

if [ "$pkg_version" != "$tauri_version" ] || [ "$pkg_version" != "$cargo_version" ] || [ "$pkg_version" != "$lock_version" ]; then
  echo "check-versions: versions differ; keep all four files in sync" >&2
  exit 1
fi

if [ -n "${GITHUB_REF_NAME:-}" ]; then
  tag="${GITHUB_REF_NAME#v}"
  if [ "$tag" != "$pkg_version" ]; then
    echo "check-versions: tag v$tag does not match files ($pkg_version)" >&2
    exit 1
  fi
fi

echo "check-versions: ok ($pkg_version)"
