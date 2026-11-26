#!/usr/bin/env bash
set -euo pipefail
FORGE_WORKSPACE="$(cd -- "$(dirname -- "$0")/.." && pwd)"
source "$FORGE_WORKSPACE/forge-api/scripts/runtime-env.sh"
if [[ -x "$FORGE_WORKSPACE/forge-web/.toolchains/node/bin/node" ]]; then
  export PATH="$FORGE_WORKSPACE/forge-web/.toolchains/node/bin:$PATH"
fi
exec python3 "$FORGE_WORKSPACE/scripts/workspace.py" dev "$@"
