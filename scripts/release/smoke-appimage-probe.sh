#!/usr/bin/env bash
# Probe an AppImage that is already running under one Xvfb session.
# DISPLAY and XAUTHORITY must be set by the parent xvfb-run; this script
# starts the app and reads windows/processes on that same display.
#
#   smoke-appimage-probe.sh --appimage /path/to/Varve.AppImage
set -euo pipefail

APPIMAGE=""
HOLD_SECONDS="${HOLD_SECONDS:-25}"
HOLD_WEBKIT_SECONDS="${HOLD_WEBKIT_SECONDS:-3}"

usage() {
  echo "Usage: $0 --appimage <Varve-*.AppImage>" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appimage)
      APPIMAGE="${2:-}"
      shift 2
      ;;
    --appimage=*)
      APPIMAGE="${1#*=}"
      shift
      ;;
    --seconds)
      HOLD_SECONDS="${2:-}"
      shift 2
      ;;
    --webkit-seconds)
      HOLD_WEBKIT_SECONDS="${2:-}"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$APPIMAGE" ]] || usage
[[ -f "$APPIMAGE" ]] || { echo "AppImage not found: $APPIMAGE" >&2; exit 1; }

if [[ -z "${DISPLAY:-}" ]]; then
  echo "REFUSING: probe must share the Xvfb display (DISPLAY is unset)" >&2
  exit 1
fi

export APPIMAGE_EXTRACT_AND_RUN=1
LOG="${VARVE_APPIMAGE_PROBE_LOG:-/tmp/varve-appimage-smoke.log}"
: >"$LOG"

"$APPIMAGE" --appimage-extract-and-run >>"$LOG" 2>&1 &
PID=$!

fail() {
  echo "$1" >&2
  echo "--- log ---" >&2
  head -40 "$LOG" >&2 || true
  echo "--- xwininfo ---" >&2
  xwininfo -root -tree 2>&1 | head -40 >&2 || true
  echo "--- processes ---" >&2
  ps aux | head -40 >&2 || true
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  exit 1
}

webkit_counts() {
  local web net
  web="$(pgrep -fc WebKitWebProcess 2>/dev/null || true)"
  net="$(pgrep -fc WebKitNetworkProcess 2>/dev/null || true)"
  echo "${web:-0} ${net:-0}"
}

i=0
saw_window=0
while (( i < HOLD_SECONDS )); do
  sleep 1
  i=$((i + 1))
  if ! kill -0 "$PID" 2>/dev/null; then
    fail "AppImage exited early"
  fi
  if grep -qiE 'EGL_BAD_PARAMETER|Aborting|libwebkit2gtk-4\.1\.so\.0: cannot open|Unable to spawn a new child process|Failed to execute child process' "$LOG"; then
    fail "WebKit/EGL/spawn failure in app output"
  fi
  WINDOWS="$(xwininfo -root -tree 2>/dev/null || true)"
  if printf '%s\n' "$WINDOWS" | grep -qiE 'varve|WebKitGtk|GtkApplication'; then
    saw_window=1
    read -r WEB_PROCS NET_PROCS <<<"$(webkit_counts)"
    if (( WEB_PROCS >= 1 && NET_PROCS >= 1 )); then
      hold=0
      while (( hold < HOLD_WEBKIT_SECONDS )); do
        sleep 1
        hold=$((hold + 1))
        if ! kill -0 "$PID" 2>/dev/null; then
          fail "AppImage exited after the window appeared"
        fi
        if grep -qiE 'EGL_BAD_PARAMETER|Aborting|Unable to spawn a new child process|Failed to execute child process' "$LOG"; then
          fail "WebKit aborted after the window appeared"
        fi
        read -r WEB_PROCS NET_PROCS <<<"$(webkit_counts)"
        if (( WEB_PROCS < 1 || NET_PROCS < 1 )); then
          fail "WebKit helpers died after the window appeared (web=${WEB_PROCS} net=${NET_PROCS})"
        fi
      done
      echo "WINDOW_OK web_processes=${WEB_PROCS} network_processes=${NET_PROCS}"
      kill "$PID" 2>/dev/null || true
      wait "$PID" 2>/dev/null || true
      exit 0
    fi
  fi
done

if (( saw_window == 1 )); then
  read -r WEB_PROCS NET_PROCS <<<"$(webkit_counts)"
  fail "Window appeared but WebKit helpers were missing (web=${WEB_PROCS:-0} net=${NET_PROCS:-0})"
fi
fail "No window after ${HOLD_SECONDS}s"
