#!/usr/bin/env bash
# Publish the Apple signing + notarization secrets that .github/workflows/release.yml
# needs to ship a macOS build that opens without the Gatekeeper warning.
#
# Run this once, interactively, from a Mac whose login keychain holds the
# "Developer ID Application" certificate and its private key:
#
#   scripts/macos/setup-github-secrets.sh                # export the identity, notarize with an Apple ID
#   scripts/macos/setup-github-secrets.sh --p12 cert.p12 # reuse a .p12 exported from Keychain Access
#   scripts/macos/setup-github-secrets.sh \
#     --api-key ~/AuthKey_ABC123DEFG.p8 --api-issuer 00000000-0000-...   # notarize with a team API key
#   scripts/macos/setup-github-secrets.sh --skip-certificate --api-key ... --api-issuer ...
#                                                        # only (re)configure notarization
#
# Secrets written to GitHub (repo: $GITHUB_REPOSITORY, default gh-Constant/prior):
#   APPLE_CERTIFICATE           base64 PKCS#12 with the Developer ID identity (+ Apple intermediate)
#   APPLE_CERTIFICATE_PASSWORD  password protecting that PKCS#12
#   APPLE_TEAM_ID               team id taken from the certificate name
#   Notarization, either (preferred: a team key that does not depend on one person's account)
#   APPLE_API_KEY               App Store Connect key id (AuthKey_<id>.p8)
#   APPLE_API_ISSUER            App Store Connect issuer id (UUID)
#   APPLE_API_KEY_BASE64        the .p8 file, base64
#   or
#   APPLE_ID                    Apple account e-mail used for notarization
#   APPLE_PASSWORD              app-specific password from https://account.apple.com/account/manage
#
# Passwords are read from the terminal and streamed to `gh secret set` over stdin;
# nothing is logged, written to the repository, or passed on a command line.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$script_dir/lib.sh"

repo="${GITHUB_REPOSITORY:-gh-Constant/prior}"
p12_input=""
api_key_path=""
api_issuer=""
skip_notarization=0
skip_certificate=0

while [ $# -gt 0 ]; do
  case "$1" in
    --p12) p12_input="$2"; shift 2 ;;
    --api-key) api_key_path="$2"; shift 2 ;;
    --api-issuer) api_issuer="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --skip-notarization) skip_notarization=1; shift ;;
    --skip-certificate) skip_certificate=1; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ "$skip_certificate" = "0" ] || [ "$skip_notarization" = "0" ] || die "nothing to do"
if [ -n "$api_key_path" ] || [ -n "$api_issuer" ]; then
  [ -n "$api_key_path" ] && [ -n "$api_issuer" ] || die "--api-key and --api-issuer go together"
  [ -f "$api_key_path" ] || die "file not found: $api_key_path"
  api_key_id="$(basename "$api_key_path" .p8)"
  api_key_id="${api_key_id#AuthKey_}"
  [ "${#api_key_id}" -eq 10 ] || die "cannot derive the key id from '$api_key_path' (expected AuthKey_<10 chars>.p8)"
fi

command -v gh >/dev/null || die "GitHub CLI (gh) is required"
gh auth status >/dev/null 2>&1 || die "run 'gh auth login' first"
if [ "$skip_certificate" = "0" ] || { [ "$skip_notarization" = "0" ] && [ -z "$api_key_path" ]; }; then
  [ -t 0 ] || die "this script must run in an interactive terminal (it prompts for passwords)"
fi

identity="$(find_developer_id_identity)"
[ -n "$identity" ] || die "no 'Developer ID Application' identity in the keychain. Create one in https://developer.apple.com/account/resources/certificates and install it in Keychain Access."
team_id="$(team_id_from_identity "$identity")"
[ -n "$team_id" ] || die "could not read the team id from '$identity'"
info "identity: $identity"
info "team id:  $team_id"
info "repo:     $repo"

# Dump a PKCS#12 to unencrypted PEM. Keychain Access / `security export` still write the
# legacy RC2/3DES format that OpenSSL 3 only reads with -legacy, so try both.
p12_to_pem() {
  local p12="$1" password="$2" out="$3"
  openssl pkcs12 -in "$p12" -passin "pass:$password" -nodes -legacy -out "$out" 2>/dev/null \
    || openssl pkcs12 -in "$p12" -passin "pass:$password" -nodes -out "$out" 2>/dev/null
}

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

if [ "$skip_certificate" = "0" ]; then
  read -r -s -p "Password to protect the exported .p12 (becomes APPLE_CERTIFICATE_PASSWORD): " p12_password
  echo
  [ -n "$p12_password" ] || die "the .p12 password cannot be empty"

  p12_path="$workdir/prior-developer-id.p12"
  if [ -n "$p12_input" ]; then
    [ -f "$p12_input" ] || die "file not found: $p12_input"
    read -r -s -p "Password of $p12_input: " input_password
    echo
    # Re-wrap the user's file so the stored secret always uses the password entered above.
    p12_to_pem "$p12_input" "$input_password" "$workdir/all.pem" \
      || die "could not read $p12_input with that password"
  else
    # `security export` cannot export a single identity, so export every identity in the
    # keychain and keep only the Developer ID one below. Keychain Access may prompt to
    # allow access to each private key.
    info "exporting identities from the login keychain (allow the keychain prompts)"
    security export -t identities -f pkcs12 -P "$p12_password" -o "$workdir/all.p12" \
      || die "keychain export failed"
    p12_to_pem "$workdir/all.p12" "$p12_password" "$workdir/all.pem" \
      || die "could not parse the exported identities"
  fi

  # Keep only the certificate + private key whose localKeyID matches the Developer ID
  # certificate; the exported bundle may also contain "Apple Development" identities.
  awk -v want_name="friendlyName: $identity" -v want_cn="CN=$identity" '
    /^Bag Attributes/ { block = ""; capturing = 1 }
    capturing { block = block $0 "\n" }
    /^-----END (CERTIFICATE|PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----/ {
      if (capturing) {
        blocks[++n] = block
        capturing = 0
      }
    }
    END {
      for (i = 1; i <= n; i++) if (index(blocks[i], want_name) || index(blocks[i], want_cn)) {
        match(blocks[i], /localKeyID: [^\n]*/)
        key_id = substr(blocks[i], RSTART, RLENGTH)
        break
      }
      if (key_id == "") exit 2
      for (i = 1; i <= n; i++) if (index(blocks[i], key_id)) printf "%s", blocks[i]
    }
  ' "$workdir/all.pem" > "$workdir/identity.pem" || die "the export does not contain '$identity'"

  openssl x509 -in "$workdir/identity.pem" -out "$workdir/cert.pem" >/dev/null 2>&1 \
    || die "no certificate found for '$identity'"
  openssl pkey -in "$workdir/identity.pem" -out "$workdir/key.pem" >/dev/null 2>&1 \
    || die "no private key found for '$identity' (export the identity, not just the certificate)"

  # Ship the Apple intermediate with the identity so a fresh CI keychain can build the chain.
  extra_args=()
  if security find-certificate -c "Developer ID Certification Authority" -p > "$workdir/intermediate.pem" 2>/dev/null \
     && [ -s "$workdir/intermediate.pem" ]; then
    extra_args+=(-certfile "$workdir/intermediate.pem")
  fi

  # -legacy keeps the PKCS#12 readable by `security import` on every macOS runner.
  openssl pkcs12 -export -legacy \
    -inkey "$workdir/key.pem" -in "$workdir/cert.pem" ${extra_args[@]+"${extra_args[@]}"} \
    -name "$identity" -passout "pass:$p12_password" -out "$p12_path" 2>/dev/null \
    || openssl pkcs12 -export \
         -inkey "$workdir/key.pem" -in "$workdir/cert.pem" ${extra_args[@]+"${extra_args[@]}"} \
         -name "$identity" -passout "pass:$p12_password" -out "$p12_path"

  # Sanity check: import into a throwaway keychain exactly like the workflow does.
  check_keychain="$workdir/check.keychain-db"
  security create-keychain -p "check" "$check_keychain"
  security import "$p12_path" -k "$check_keychain" -P "$p12_password" -A -t cert -f pkcs12 >/dev/null
  found="$(find_developer_id_identity "$check_keychain")"
  security delete-keychain "$check_keychain" >/dev/null 2>&1 || true
  [ "$found" = "$identity" ] || die "the generated .p12 does not import cleanly (found: '${found:-nothing}')"
  info ".p12 verified"
fi

apple_id=""
apple_password=""
if [ "$skip_notarization" = "0" ] && [ -n "$api_key_path" ]; then
  info "checking the App Store Connect key $api_key_id with notarytool"
  xcrun notarytool history --key "$api_key_path" --key-id "$api_key_id" --issuer "$api_issuer" >/dev/null \
    || die "notarytool rejected the API key (check the issuer id and that the key has the Developer role)"
elif [ "$skip_notarization" = "0" ]; then
  read -r -p "Apple ID e-mail used for notarization: " apple_id
  [ -n "$apple_id" ] || die "the Apple ID cannot be empty (or pass --skip-notarization)"
  read -r -s -p "App-specific password for $apple_id (https://account.apple.com/account/manage): " apple_password
  echo
  [ -n "$apple_password" ] || die "the app-specific password cannot be empty"

  info "checking the notarization credentials with notarytool"
  xcrun notarytool history --apple-id "$apple_id" --password "$apple_password" --team-id "$team_id" >/dev/null \
    || die "notarytool rejected these credentials"
fi

set_secret() {
  # $1 name, value on stdin
  gh secret set "$1" --repo "$repo" >/dev/null
  info "set $1"
}

if [ "$skip_certificate" = "0" ]; then
  base64 < "$p12_path" | tr -d '\n' | set_secret APPLE_CERTIFICATE
  printf '%s' "$p12_password" | set_secret APPLE_CERTIFICATE_PASSWORD
fi
printf '%s' "$team_id" | set_secret APPLE_TEAM_ID
if [ "$skip_notarization" = "0" ] && [ -n "$api_key_path" ]; then
  printf '%s' "$api_key_id" | set_secret APPLE_API_KEY
  printf '%s' "$api_issuer" | set_secret APPLE_API_ISSUER
  base64 < "$api_key_path" | tr -d '\n' | set_secret APPLE_API_KEY_BASE64
  # The workflow prefers APPLE_ID/APPLE_PASSWORD when both exist; drop them so the team key wins.
  for stale in APPLE_ID APPLE_PASSWORD; do
    gh secret delete "$stale" --repo "$repo" >/dev/null 2>&1 && info "removed $stale" || true
  done
elif [ "$skip_notarization" = "0" ]; then
  printf '%s' "$apple_id" | set_secret APPLE_ID
  printf '%s' "$apple_password" | set_secret APPLE_PASSWORD
else
  warn "notarization secrets left untouched by this run"
fi

existing="$(gh secret list --repo "$repo" | awk '{print $1}')"
has() { printf '%s\n' "$existing" | grep -qx "$1"; }
if has APPLE_CERTIFICATE && has APPLE_CERTIFICATE_PASSWORD \
   && { { has APPLE_API_KEY && has APPLE_API_ISSUER && has APPLE_API_KEY_BASE64; } || { has APPLE_ID && has APPLE_PASSWORD; }; }; then
  info "done. The next 'v*.*.*' tag will produce a signed and notarized macOS build."
else
  warn "done, but the repo is still missing secrets for a warning-free macOS release:"
  for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD; do has "$name" || warn "  $name"; done
  has APPLE_API_KEY || has APPLE_ID || warn "  notarization (APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_BASE64 or APPLE_ID/APPLE_PASSWORD)"
fi
