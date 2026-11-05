#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-run}"
case "$mode" in
  run|--verify|--debug|--logs|--telemetry) ;;
  *) echo "Usage: $0 [--verify|--debug|--logs|--telemetry]" >&2; exit 2 ;;
esac
app_name=$(node --input-type=module -e 'import config from "./safari/config.json" with {type:"json"}; process.stdout.write(config.appName)')
app_path="$PWD/artifacts/safari/Debug/$app_name.app"
# Stop only this repository's app, not Safari or another installation.
existing=$(pgrep -f "^$app_path/Contents/MacOS/$app_name$" || true)
if [[ -n "$existing" ]]; then
  kill $existing
fi
npm run package:safari:dev
/usr/bin/open -n "$app_path"
if [[ "$mode" == "--verify" ]]; then
  for attempt in 1 2 3 4 5; do
    if pgrep -f "^$app_path/Contents/MacOS/$app_name$" >/dev/null; then
      echo "Running: $app_path"
      exit 0
    fi
    sleep 1
  done
  echo "Aside did not stay running. Inspect the macOS crash report." >&2
  exit 1
fi

case "$mode" in
  --debug)
    exec lldb --attach-name "$app_name" --wait-for
    ;;
  --logs)
    exec /usr/bin/log stream --info --style compact --predicate "process == \"$app_name\""
    ;;
  --telemetry)
    bundle_id=$(node --input-type=module -e 'import config from "./safari/config.json" with {type:"json"}; process.stdout.write(config.bundleIdentifier)')
    exec /usr/bin/log stream --info --style compact --predicate "subsystem == \"$bundle_id\""
    ;;
esac
