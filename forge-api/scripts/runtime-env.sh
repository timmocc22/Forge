#!/usr/bin/env bash
# Local launch helpers; no user-wide Java or Node settings are changed.
set -euo pipefail
FORGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -x "$FORGE_ROOT/.toolchains/node/bin/node" ]]; then
  export PATH="$FORGE_ROOT/.toolchains/node/bin:$PATH"
fi

forge_java_is_supported() {
  [[ -x "$1/bin/java" ]] || return 1
  local major
  major="$("$1/bin/java" -XshowSettings:properties -version 2>&1 | awk '/java.specification.version =/ {print $3}')"
  [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 25 ))
}

FORGE_JAVA_HOME="${JAVA_HOME:-}"
if ! forge_java_is_supported "$FORGE_JAVA_HOME"; then
  if [[ -x /usr/libexec/java_home ]]; then
    FORGE_JAVA_HOME="$(/usr/libexec/java_home -v 25 2>/dev/null || true)"
  fi
fi
if ! forge_java_is_supported "$FORGE_JAVA_HOME"; then
  for candidate in "$HOME"/.gradle/jdks/*/Contents/Home "$HOME"/.gradle/jdks/*/*/Contents/Home; do
    if forge_java_is_supported "$candidate"; then
      FORGE_JAVA_HOME="$candidate"
      break
    fi
  done
fi
if ! forge_java_is_supported "$FORGE_JAVA_HOME"; then
  echo 'Forge requires JDK 25 or newer. Install it and set JAVA_HOME.' >&2
  exit 1
fi
export JAVA_HOME="$FORGE_JAVA_HOME"
