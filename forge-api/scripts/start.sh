#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/runtime-env.sh"
cd "$FORGE_ROOT"
exec "$JAVA_HOME/bin/java" --enable-native-access=ALL-UNNAMED -jar build/libs/forge-api-0.1.0.jar
