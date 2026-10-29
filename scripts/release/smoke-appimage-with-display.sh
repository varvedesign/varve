#!/usr/bin/env bash
# Start one Xvfb display and run the remaining arguments as children of it.
# Debian ships xvfb-run; Fedora does not. Both have Xvfb.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 2
fi

n=99
while [[ -e "/tmp/.X${n}-lock" || -e "/tmp/.X11-unix/X${n}" ]]; do
  n=$((n + 1))
  if (( n > 199 )); then
    echo "No free X display in :99-:199" >&2
    exit 1
  fi
done

export DISPLAY=":${n}"
Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -ac &
XVFB_PID=$!
cleanup() {
  kill "$XVFB_PID" 2>/dev/null || true
  wait "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if [[ -e "/tmp/.X11-unix/X${n}" || -e "/tmp/.X${n}-lock" ]]; then
    ready=1
    break
  fi
  sleep 0.1
done
if (( ready == 0 )); then
  echo "Xvfb did not create display ${DISPLAY}" >&2
  exit 1
fi

if command -v dbus-run-session >/dev/null 2>&1; then
  dbus-run-session -- "$@"
else
  "$@"
fi
