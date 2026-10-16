#!/usr/bin/env bash
# Reproducible PDF/A and PDF/UA validation using veraPDF.
#
# Grounded in the installed validator's documented contract
# (https://docs.verapdf.org/cli/validation/):
#   - Built-in standards are selected with `--flavour` (for example 1b, 2b,
#     ua1). `--profile` is a custom validation-profile FILE path, not a
#     standard name; passing a short identifier there is an error, not a
#     validation.
#   - The verdict comes from the machine-readable report's
#     `isCompliant` attribute. The process exit code is treated only as a
#     hint: a run that exits 0 with a noncompliant or unreadable report
#     must not produce a green badge, so this script fails closed.
#   - veraPDF's standard scope covers PDF/A and PDF/UA. It cannot validate
#     PDF/X. Requests for PDF/X are refused with exit 3 instead of being
#     passed to a validator that cannot honour them; use press-oriented
#     preflight tooling for PDF/X claims.
#
# Usage:
#   ./scripts/validate-pdf.sh <pdf-file> [flavour] [--raw] [--no-evidence]
#
# Flavours are passed through to `--flavour` after alias expansion:
#   a1b|a2b|a3b -> 1b|2b|3b (back-compat aliases); anything else
#   (1a, 2a, 2b, 2u, 3a, 3b, 3u, ua1, ...) is forwarded unchanged so the
#   installed veraPDF remains the authority on what it supports.
#
# Evidence: each run archives the full machine-readable report plus a
# summary line (input SHA-256, byte size, veraPDF version, flavour,
# verdict, UTC timestamp) under reports/pdf-validation/ in the repository
# root. Disable with --no-evidence or VARVE_PDF_VALIDATION_EVIDENCE=0.
#
# Exit codes:
#   0 - report says compliant (isCompliant="true")
#   1 - veraPDF not found
#   2 - noncompliant, unreadable/missing report, or validator error
#   3 - invalid arguments, including unsupported PDF/X profiles

set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERAPDF_CMD="${VERAPDF_CMD:-verapdf}"
EVIDENCE_DIR="${VARVE_PDF_VALIDATION_EVIDENCE_DIR:-$SCRIPT_ROOT/reports/pdf-validation}"

usage() {
    sed -n '2,/^set -euo/p' "$0" | sed '/^set -euo/d; s/^# \{0,1\}//'
}

if [ "$#" -lt 1 ]; then
    usage
    exit 3
fi

PDF_FILE="$1"
shift

FLAVOUR="1b"
RAW=0
EVIDENCE=1
while [ "$#" -gt 0 ]; do
    case "$1" in
        --raw) RAW=1 ;;
        --no-evidence) EVIDENCE=0 ;;
        -h|--help) usage; exit 0 ;;
        *) FLAVOUR="$1" ;;
    esac
    shift
done

# Map back-compat aliases to veraPDF flavour identifiers. Anything else is
# forwarded verbatim: the installed validator decides what it supports, and
# its error for an unknown flavour must reach the caller untouched.
case "$FLAVOUR" in
    a1b) FLAVOUR="1b" ;;
    a2b) FLAVOUR="2b" ;;
    a3b) FLAVOUR="3b" ;;
    x1a|x-1a|x1|x4|x-4|x4i)
        echo "ERROR: PDF/X ($FLAVOUR) is outside veraPDF's validation scope (PDF/A, PDF/UA)."
        echo "This script refuses to emit a badge it cannot verify. Use press-oriented"
        echo "preflight tooling for PDF/X, or validate the archival target with PDF/A."
        exit 3
        ;;
esac

if command -v "$VERAPDF_CMD" &>/dev/null; then
    VERAPDF="$VERAPDF_CMD"
elif [ -n "${VALIDATOR_DIR:-}" ] && [ -f "$VALIDATOR_DIR/verapdf" ]; then
    VERAPDF="$VALIDATOR_DIR/verapdf"
else
    echo "ERROR: veraPDF not found on PATH or at VERAPDF_CMD/VALIDATOR_DIR."
    echo ""
    echo "Install veraPDF:"
    echo "  Linux:   Download from https://github.com/veraPDF/veraPDF-apps/releases"
    echo "  macOS:   brew install verapdf"
    echo "  Docker:  docker pull openpreserve/verapdf"
    exit 1
fi

if [ ! -f "$PDF_FILE" ]; then
    echo "ERROR: PDF file not found: $PDF_FILE"
    exit 2
fi
case "$PDF_FILE" in
    -*) PDF_FILE="./$PDF_FILE" ;;
esac

VERAPDF_VERSION="$("$VERAPDF" --version 2>&1 | head -n 1 || echo "unknown")"
REPORT="$(mktemp /tmp/varve-pdf-validation.XXXXXX.xml)"
trap 'rm -f "$REPORT"' EXIT

echo "Validating: $PDF_FILE"
echo "Flavour:    $FLAVOUR"
echo "Validator:  $VERAPDF_VERSION"
echo ""

# One invocation, machine-readable output. The report is the verdict; stdout
# is never parsed for words like PASSED because validators reword them.
set +e
"$VERAPDF" --flavour "$FLAVOUR" --format xml "$PDF_FILE" >"$REPORT" 2>/dev/null
VERAPDF_EXIT=$?
set -e

if [ "$RAW" -eq 1 ]; then
    cat "$REPORT"
fi

# Fail closed: without at least one isCompliant attribute the report proves
# nothing, whether the process exited 0 or not.
if ! grep -q 'isCompliant=' "$REPORT"; then
    echo "VALIDATION FAILED: veraPDF produced no machine-readable compliance"
    echo "report (process exit $VERAPDF_EXIT)."
    echo "---- validator output head ----"
    head -c 2000 "$REPORT" || echo "(empty report)"
    echo ""
    VERDICT="no-report"
else
    # Compliant only when at least one report entry says true and none says
    # false. Batch jobs and per-item reports both reduce to this rule.
    if grep -q 'isCompliant="false"' "$REPORT"; then
        VERDICT="noncompliant"
    elif grep -q 'isCompliant="true"' "$REPORT"; then
        VERDICT="compliant"
    else
        VERDICT="no-report"
    fi
fi

# Evidence archive: report + summary, keyed by file and timestamp, so a
# conformance claim can always be re-checked against its input bytes.
if [ "$EVIDENCE" -eq 1 ] && [ "$VERDICT" != "no-report" ]; then
    mkdir -p "$EVIDENCE_DIR"
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    BASE="$(basename "$PDF_FILE")"
    INPUT_SHA="$(sha256sum "$PDF_FILE" | awk '{print $1}')"
    EVIDENCE_BASE="$EVIDENCE_DIR/${BASE}.${FLAVOUR}.${STAMP}"
    cp "$REPORT" "${EVIDENCE_BASE}.report.xml"
    {
        echo "input: $PDF_FILE"
        echo "input_sha256: $INPUT_SHA"
        echo "input_bytes: $(wc -c < "$PDF_FILE")"
        echo "validator: $VERAPDF_VERSION"
        echo "flavour: $FLAVOUR"
        echo "verapdf_exit: $VERAPDF_EXIT"
        echo "verdict: $VERDICT"
        echo "timestamp_utc: $STAMP"
    } > "${EVIDENCE_BASE}.summary.txt"
    echo "Evidence archived: ${EVIDENCE_BASE}.report.xml"
fi

echo ""
case "$VERDICT" in
    compliant)
        echo "VALIDATION PASSED (report: isCompliant=true)"
        exit 0
        ;;
    noncompliant)
        echo "VALIDATION FAILED (report: isCompliant=false, process exit $VERAPDF_EXIT)"
        exit 2
        ;;
    *)
        echo "VALIDATION FAILED (no machine-readable compliance report)"
        exit 2
        ;;
esac
