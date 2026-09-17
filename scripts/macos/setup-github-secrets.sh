#!/usr/bin/env bash
# Publish the Apple signing + notarization secrets that .github/workflows/release.yml
# needs to ship a macOS build that opens without the Gatekeeper warning.
#
# Run this once, interactively, from a Mac whose login keychain holds the
# "Developer ID Application" certificate and its private key:
#
#   scripts/macos/setup-github-secrets.sh                # export the identity from the keychain
#   scripts/macos/setup-github-secrets.sh --p12 cert.p12 # reuse a .p12 exported from Keychain Access
#
# Secrets written to GitHub (repo: $GITHUB_REPOSITORY, default gh-Constant/prior):
#   APPLE_CERTIFICATE           base64 PKCS#12 with the Developer ID identity (+ Apple intermediate)
#   APPLE_CERTIFICATE_PASSWORD  password protecting that PKCS#12
#   APPLE_ID                    Apple account e-mail used for notarization
#   APPLE_PASSWORD              app-specific password from https://account.apple.com/account/manage
#   APPLE_TEAM_ID               team id taken from the certificate name
#
# Passwords are read from the terminal and streamed to `gh secret set` over stdin;
# nothing is logged, written to the repository, or passed on a command line.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$script_dir/lib.sh"

repo="${GITHUB_REPOSITORY:-gh-Constant/prior}"
p12_input=""
skip_notarization=0

while [ $# -gt 0 ]; do
  case "$1" in
    --p12) p12_input="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --skip-notarization) skip_notarization=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v gh >/dev/null || die "GitHub CLI (gh) is required"
gh auth status >/dev/null 2>&1 || die "run 'gh auth login' first"
[ -t 0 ] || die "this script must run in an interactive terminal (it prompts for passwords)"

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

apple_id=""
apple_password=""
if [ "$skip_notarization" = "0" ]; then
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

base64 < "$p12_path" | tr -d '\n' | set_secret APPLE_CERTIFICATE
printf '%s' "$p12_password" | set_secret APPLE_CERTIFICATE_PASSWORD
printf '%s' "$team_id" | set_secret APPLE_TEAM_ID
if [ "$skip_notarization" = "0" ]; then
  printf '%s' "$apple_id" | set_secret APPLE_ID
  printf '%s' "$apple_password" | set_secret APPLE_PASSWORD
else
  warn "notarization secrets not set: the release will be signed but macOS still shows a warning until APPLE_ID/APPLE_PASSWORD exist"
fi

info "done. The next 'v*.*.*' tag will produce a signed and notarized macOS build."
