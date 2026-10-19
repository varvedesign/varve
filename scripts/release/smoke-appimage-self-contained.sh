#!/usr/bin/env bash
# Launch an AppImage in a clean, offline container that does not have
# libwebkit2gtk or GTK installed. This is the AppImageHub catalog shape:
# no network, no host WebKit, a window must appear on one Xvfb display.
#
#   scripts/release/smoke-appimage-self-contained.sh --appimage path/to/Varve-*.AppImage
#   scripts/release/smoke-appimage-self-contained.sh --appimage path --distro fedora
#   scripts/release/smoke-appimage-self-contained.sh --appimage path --distro all
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE="$REPO_ROOT/scripts/release/smoke-appimage-probe.sh"
WITH_DISPLAY="$REPO_ROOT/scripts/release/smoke-appimage-with-display.sh"
APPIMAGE=""
HOLD_SECONDS="${VARVE_APPIMAGE_SMOKE_SECONDS:-25}"
HOLD_WEBKIT_SECONDS="${VARVE_APPIMAGE_SMOKE_WEBKIT_SECONDS:-3}"
DISTRO="${VARVE_APPIMAGE_SMOKE_DISTRO:-ubuntu}"
LOG_DIR=""

usage() {
  echo "Usage: $0 --appimage <Varve-*.AppImage> [--distro ubuntu|fedora|all] [--log-dir DIR]" >&2
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
    --distro)
      DISTRO="${2:-}"
      shift 2
      ;;
    --distro=*)
      DISTRO="${1#*=}"
      shift
      ;;
    --log-dir)
      LOG_DIR="${2:-}"
      shift 2
      ;;
    --log-dir=*)
      LOG_DIR="${1#*=}"
      shift
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
[[ -x "$PROBE" ]] || chmod +x "$PROBE"
[[ -x "$WITH_DISPLAY" ]] || chmod +x "$WITH_DISPLAY"

if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNTIME=docker
else
  echo "No usable container runtime (podman or docker)." >&2
  exit 1
fi

containerfile_for() {
  case "$1" in
    ubuntu) echo "$REPO_ROOT/scripts/release/appimage-smoke.Containerfile" ;;
    fedora) echo "$REPO_ROOT/scripts/release/appimage-smoke-fedora.Containerfile" ;;
    *)
      echo "Unknown smoke distro: $1 (expected ubuntu, fedora, or all)" >&2
      exit 2
      ;;
  esac
}

refuse_webkit() {
  case "$1" in
    ubuntu)
      cat <<'EOF'
if dpkg -l "libwebkit2gtk*" 2>/dev/null | grep -q "^ii"; then
  echo "REFUSING: libwebkit2gtk is installed in the smoke image" >&2
  exit 1
fi
if dpkg -l "libgtk-3-0" 2>/dev/null | grep -q "^ii"; then
  echo "REFUSING: libgtk-3-0 is installed in the smoke image" >&2
  exit 1
fi
EOF
      ;;
    fedora)
      cat <<'EOF'
if rpm -q webkit2gtk4.1 >/dev/null 2>&1 || rpm -q webkit2gtk3 >/dev/null 2>&1; then
  echo "REFUSING: webkit2gtk is installed in the smoke image" >&2
  exit 1
fi
if rpm -q gtk3 >/dev/null 2>&1; then
  echo "REFUSING: gtk3 is installed in the smoke image" >&2
  exit 1
fi
EOF
      ;;
  esac
}

run_one() {
  local distro="$1"
  local containerfile image_tag log status
  containerfile="$(containerfile_for "$distro")"
  image_tag="${VARVE_APPIMAGE_SMOKE_IMAGE:-varve-appimage-smoke:$distro}"

  echo "Building $image_tag with $RUNTIME (network allowed only for the image build)..."
  "$RUNTIME" build --file "$containerfile" --tag "$image_tag" "$REPO_ROOT/scripts/release"

  if [[ -n "$LOG_DIR" ]]; then
    mkdir -p "$LOG_DIR"
    log="$LOG_DIR/${distro}.log"
  else
    log="$(mktemp)"
  fi
  echo "Launching $(basename "$APPIMAGE") on $distro with --network none, no host WebKitGTK..."
  set +e
  "$RUNTIME" run --rm --network none \
    --security-opt label=disable \
    --security-opt seccomp=unconfined \
    -e HOLD_SECONDS="$HOLD_SECONDS" \
    -e HOLD_WEBKIT_SECONDS="$HOLD_WEBKIT_SECONDS" \
    -e VARVE_APPIMAGE_PROBE_LOG="/tmp/varve-appimage-smoke.log" \
    -v "$APPIMAGE:/opt/Varve.AppImage:ro" \
    -v "$PROBE:/opt/smoke-appimage-probe.sh:ro" \
    -v "$WITH_DISPLAY:/opt/smoke-appimage-with-display.sh:ro" \
    "$image_tag" \
    bash -lc "
      set -euo pipefail
      $(refuse_webkit "$distro")
      bash /opt/smoke-appimage-with-display.sh \
        bash /opt/smoke-appimage-probe.sh --appimage /opt/Varve.AppImage
    " | tee "$log"
  status=${PIPESTATUS[0]}
  set -e
  if [[ "$status" -ne 0 ]]; then
    echo "AppImage self-contained smoke FAILED ($distro)" >&2
    [[ -n "$LOG_DIR" ]] || rm -f "$log"
    exit "$status"
  fi
  if ! grep -q WINDOW_OK "$log"; then
    echo "AppImage self-contained smoke produced no WINDOW_OK marker ($distro)" >&2
    [[ -n "$LOG_DIR" ]] || rm -f "$log"
    exit 1
  fi
  if ! grep -qE 'WINDOW_OK web_processes=[1-9][0-9]* network_processes=[1-9][0-9]*' "$log"; then
    echo "AppImage self-contained smoke did not report live WebKit helpers ($distro)" >&2
    [[ -n "$LOG_DIR" ]] || rm -f "$log"
    exit 1
  fi
  [[ -n "$LOG_DIR" ]] || rm -f "$log"
  echo "AppImage self-contained smoke PASSED ($distro, offline, no host libwebkit2gtk)"
}

if [[ "$DISTRO" == all ]]; then
  run_one ubuntu
  run_one fedora
else
  run_one "$DISTRO"
fi
