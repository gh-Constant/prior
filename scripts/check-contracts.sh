#!/bin/sh
# Placeholder contract guard: diffs the live sync/auth surface against the
# frozen specs/OPENAPI.yaml. Today it verifies the frozen spec exists and
# lists the frozen operations; a full wire-diff (e.g. via oasdiff) can replace
# the body without changing the release.yml contract.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SPEC="$ROOT/specs/OPENAPI.yaml"

[ -f "$SPEC" ] || { echo "check-contracts: missing $SPEC" >&2; exit 1; }

echo "check-contracts: frozen operations:"
grep -E "^  /v1/" "$SPEC" || { echo "check-contracts: no /v1/ paths in $SPEC" >&2; exit 1; }

for path in "/v1/sync/pull" "/v1/sync/push" "/v1/workspace/sync" "/v1/me" "/v1/settings" "/v1/agent/chats"; do
  grep -q "$path" "$SPEC" || { echo "check-contracts: frozen spec missing $path" >&2; exit 1; }
done

echo "check-contracts: ok (placeholder; wire diff not yet enforced)"
