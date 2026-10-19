#!/usr/bin/env bash
# Launch an AppImage in a clean, offline container that does not have
# libwebkit2gtk or GTK installed. This is the AppImageHub catalog shape:
# no network, no host WebKit, a window must appear.
#
#   scripts/release/smoke-appimage-self-contained.sh --appimage path/to/Varve-*.AppImage
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINERFILE="$REPO_ROOT/scripts/release/appimage-smoke.Containerfile"
IMAGE_TAG="${VARVE_APPIMAGE_SMOKE_IMAGE:-varve-appimage-smoke:local}"
APPIMAGE=""
HOLD_SECONDS="${VARVE_APPIMAGE_SMOKE_SECONDS:-25}"

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
    *)
      usage
      ;;
  esac
done

[[ -n "$APPIMAGE" ]] || usage
[[ -f "$APPIMAGE" ]] || { echo "AppImage not found: $APPIMAGE" >&2; exit 1; }
APPIMAGE="$(realpath "$APPIMAGE")"
chmod +x "$APPIMAGE"

if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNTIME=docker
else
  echo "No usable container runtime (podman or docker)." >&2
  exit 1
fi

echo "Building $IMAGE_TAG with $RUNTIME (network allowed only for the image build)..."
"$RUNTIME" build --file "$CONTAINERFILE" --tag "$IMAGE_TAG" "$REPO_ROOT/scripts/release"

LOG="$(mktemp)"
cleanup() { rm -f "$LOG"; }
trap cleanup EXIT

echo "Launching $(basename "$APPIMAGE") with --network none, no host WebKitGTK..."
set +e
"$RUNTIME" run --rm --network none \
  --security-opt label=disable \
  -e HOLD_SECONDS="$HOLD_SECONDS" \
  -v "$APPIMAGE:/opt/Varve.AppImage:ro" \
  "$IMAGE_TAG" \
  bash -lc '
    set -euo pipefail
    if dpkg -l "libwebkit2gtk*" 2>/dev/null | grep -q "^ii"; then
      echo "REFUSING: libwebkit2gtk is installed in the smoke image" >&2
      exit 1
    fi
    # Bind-mounted :ro — chmod here would fail. The host script already +x'd it.
    export APPIMAGE_EXTRACT_AND_RUN=1
    export WEBKIT_DISABLE_SANDBOX=1
    LOG=/tmp/varve-appimage-smoke.log
    dbus-run-session -- xvfb-run --auto-servernum \
      /opt/Varve.AppImage --appimage-extract-and-run >"$LOG" 2>&1 &
    PID=$!
    i=0
    while (( i < HOLD_SECONDS )); do
      sleep 1
      i=$((i + 1))
      if ! kill -0 "$PID" 2>/dev/null; then
        echo "AppImage exited early"
        cat "$LOG" | head -40
        wait "$PID" || true
        exit 1
      fi
      if grep -qiE "EGL_BAD_PARAMETER|Aborting|libwebkit2gtk-4.1.so.0: cannot open" "$LOG"; then
        echo "WebKit/EGL failure in app output:"
        grep -iE "EGL|Aborting|webkit|shared object" "$LOG" | head -10
        kill "$PID" 2>/dev/null || true
        exit 1
      fi
      WINDOWS="$(xwininfo -root -tree 2>/dev/null || true)"
      if printf "%s\n" "$WINDOWS" | grep -qiE "varve|WebKitGtk|GtkApplication"; then
        WEB_PROCS="$(pgrep -fc "WebKitWebProcess|WebKitNetworkProcess" || true)"
        echo "WINDOW_OK web_processes=${WEB_PROCS:-0}"
        kill "$PID" 2>/dev/null || true
        wait "$PID" 2>/dev/null || true
        exit 0
      fi
    done
    echo "No window after ${HOLD_SECONDS}s"
    echo "--- log ---"
    cat "$LOG" | head -40
    echo "--- xwininfo ---"
    xwininfo -root -tree 2>/dev/null | head -40 || true
    echo "--- processes ---"
    ps aux | head -40 || true
    kill "$PID" 2>/dev/null || true
    exit 1
  ' | tee "$LOG"
STATUS=${PIPESTATUS[0]}
set -e
if [[ "$STATUS" -ne 0 ]]; then
  echo "AppImage self-contained smoke FAILED" >&2
  exit "$STATUS"
fi
if ! grep -q WINDOW_OK "$LOG"; then
  echo "AppImage self-contained smoke produced no WINDOW_OK marker" >&2
  exit 1
fi
echo "AppImage self-contained smoke PASSED (offline, no host libwebkit2gtk)"
