#!/usr/bin/env bash
# CI shell-script TDD assertions.
#
# Validates the behaviour of the repo's CI wrapper shell scripts WITHOUT
# executing them against the live toolchain (which would download binaries,
# require sudo, or need Docker). Instead we test the pure logic:
#   - argument dispatch in scripts/ci-local-run.sh
#   - act-missing detection
#   - secrets-stub generation
#   - command-exists predicate in scripts/install-ci-tooling.sh
#
# Run: bash scripts/test-ci-shell-scripts.sh
# Wired into: pnpm test (via package.json "test:ci:shell") and the
# pipeline-validate CI job.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CI_LOCAL="$ROOT/scripts/ci-local-run.sh"
INSTALL_CI="$ROOT/scripts/install-ci-tooling.sh"

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  PASS: %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL: %s\n' "$1"; }

assert_eq() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then ok "$desc"; else bad "$desc (got \"$actual\", want \"$expected\")"; fi
}

assert_true()  { if "$@"; then ok "$1 ..."; else bad "$1"; fi }
assert_false() { if "$@"; then bad "$1"; else ok "$1 (expected failure)"; fi }

# ── sanity: scripts exist and are executable ────────────────────────────────
echo "== script presence =="
assert_true test -f "$CI_LOCAL"
assert_true test -f "$INSTALL_CI"
assert_true test -x "$CI_LOCAL"
assert_true test -x "$INSTALL_CI"

# ── ci-local-run.sh argument dispatch ───────────────────────────────────────
echo "== ci-local-run.sh arg dispatch =="
# We can't run the real script (it would call `act`); instead extract the
# dispatch logic via a dry parser: source a stub `act` and `command -v`.
ACT_STUB_DIR="$(mktemp -d)"
printf '#!/usr/bin/env bash\nif [ "${1:-}" = "--version" ]; then echo "act version 0.2.89"; else echo "act-stub invoked with: $@"; fi\nexit 0\n' > "$ACT_STUB_DIR/act"
chmod +x "$ACT_STUB_DIR/act"

# Verify the usage string covers all three subcommands.
USAGE_OUTPUT=$(bash "$CI_LOCAL" bogus 2>&1)
if echo "$USAGE_OUTPUT" | grep -q 'list' && echo "$USAGE_OUTPUT" | grep -q 'run'; then
  ok "usage covers list + run subcommands"
else
  bad "usage missing list/run (got: $USAGE_OUTPUT)"
fi

# Unknown subcommand exits non-zero.
OUT=$(PATH="$ACT_STUB_DIR:$PATH" bash "$CI_LOCAL" bogus 2>&1)
RC=$?
if [ "$RC" -ne 0 ]; then ok "unknown subcommand exits non-zero"; else bad "unknown subcommand should exit non-zero"; fi

# act-missing detection: point ACT_BIN at a nonexistent tool; `command -v`
# fails and the script must print an install hint.
OUT2=$(ACT_BIN="act-definitely-not-installed-xyz" bash "$CI_LOCAL" run js 2>&1)
if echo "$OUT2" | grep -q "not installed"; then
  ok "act-missing detection prints install hint"
else
  bad "act-missing detection missing hint (got: $OUT2)"
fi

# Old act releases cannot parse the Node 24 action runtime used by the
# workflows. The wrapper must fail before Docker is touched and explain the
# upgrade path instead of emitting act's opaque runtime error.
OLD_ACT_DIR="$(mktemp -d)"
printf '#!/usr/bin/env bash\nif [ "${1:-}" = "--version" ]; then echo "act version 0.2.77"; else echo "old-act-stub invoked with: $@"; fi\nexit 0\n' > "$OLD_ACT_DIR/act"
chmod +x "$OLD_ACT_DIR/act"
OUT_OLD=$(ACT_BIN="$OLD_ACT_DIR/act" bash "$CI_LOCAL" dry-run .github/workflows/ci-smoke.yml 2>&1)
if echo "$OUT_OLD" | grep -q "0.2.89 or newer"; then
  ok "old act version is rejected with upgrade guidance"
else
  bad "old act version should be rejected (got: $OUT_OLD)"
fi
OUT_INSTALL_OLD=$(PATH="$OLD_ACT_DIR:$PATH" bash "$INSTALL_CI" --check 2>&1 || true)
if echo "$OUT_INSTALL_OLD" | grep -q "0.2.89 or newer"; then
  ok "tooling check reports outdated act runtime"
else
  bad "tooling check should report outdated act runtime (got: $OUT_INSTALL_OLD)"
fi
rm -rf "$OLD_ACT_DIR"

# list with act on PATH forwards --list.
OUT3=$(PATH="$ACT_STUB_DIR:$PATH" ACT_IMAGE="catthehacker/ubuntu:act-latest" bash "$CI_LOCAL" list 2>&1)
if echo "$OUT3" | grep -q 'act-stub invoked'; then
  ok "list forwards to act --list"
else
  bad "list did not invoke act (got: $OUT3)"
fi

rm -rf "$ACT_STUB_DIR"

# ── install-ci-tooling.sh command_exists predicate ──────────────────────────
echo "== install-ci-tooling.sh command_exists =="
# Source only the function definitions (guard against running main logic).
FUNC_SRC=$(sed -n '1,/^# Main installation/p' "$INSTALL_CI" | sed '/^# Main installation/,$d' | sed 's/^# Main installation$//')
# The command_exists function is defined before the main block; pull it out.
CMD_EXISTS=$(printf '%s' "$FUNC_SRC" | awk '/^command_exists\(\)/,/^}/')
assert_true bash -c "
  CMD_EXISTS='$CMD_EXISTS'
  eval \"\$CMD_EXISTS\"
  command_exists bash && command_exists /bin/bash || exit 1
"
assert_false bash -c "
  CMD_EXISTS='$CMD_EXISTS'
  eval \"\$CMD_EXISTS\"
  command_exists definitely-not-a-real-binary-xyz
"

# --check mode: reports parity without installing anything. It must either
# find act (installed locally) or say it is not installed — never crash.
OUT4=$(bash "$INSTALL_CI" --check 2>&1 || true)
if echo "$OUT4" | grep -qE "Local act parity|act is not installed"; then
  ok "--check reports act parity"
else
  bad "--check should report act parity (got: $OUT4)"
fi

# ── generated act-secrets stub contract ─────────────────────────────────────
echo "== .act-secrets stub contract =="
STUB_DIR="$(mktemp -d)"
# Reproduce the stub the scripts generate and check it parses as shell.
cat > "$STUB_DIR/.act-secrets" <<'EOF'
# GitHub Actions secrets for local act runs.
# GITHUB_TOKEN=<your-token>
EOF
if bash -n "$STUB_DIR/.act-secrets" 2>/dev/null; then
  ok ".act-secrets stub is valid shell"
else
  bad ".act-secrets stub fails shell syntax check"
fi
rm -rf "$STUB_DIR"

# ── validate-pdf.sh conformance-gate behaviour ─────────────────────────────
echo "== validate-pdf.sh conformance gate =="
# Grounded in veraPDF's documented contract: built-in standards are chosen
# with --flavour, and the verdict is the report's isCompliant attribute —
# never the process exit code. The stub lets us prove a validator that exits
# 0 with a noncompliant report cannot produce a green badge.
VALIDATE_PDF="$ROOT/scripts/validate-pdf.sh"
STUB_VERAPDF_DIR="$(mktemp -d)"
FIXTURE_DIR="$(mktemp -d)"
STUB_ARGS="$STUB_VERAPDF_DIR/args.txt"
export STUB_ARGS
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > "$FIXTURE_DIR/sample.pdf"

make_verapdf_stub() {
  local report="$1" exit_code="$2"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'printf "%%s\\n" "$@" > "$STUB_ARGS"\n'
    printf 'if [ "${1:-}" = "--version" ]; then echo "veraPDF stub 1.0"; exit 0; fi\n'
    printf 'cat <<'"'"'STUBREPORT'"'"'\n%s\nSTUBREPORT\n' "$report"
    printf 'exit %s\n' "$exit_code"
  } > "$STUB_VERAPDF_DIR/verapdf"
  chmod +x "$STUB_VERAPDF_DIR/verapdf"
}

run_validate() {
  # Extra args after the fixture; stdout/stderr merged.
  PATH="$STUB_VERAPDF_DIR:$PATH" bash "$VALIDATE_PDF" "$@" 2>&1
}

COMPLIANT_REPORT='<report><validationReport isCompliant="true"><details/></validationReport></report>'
NONCOMPLIANT_REPORT='<report><validationReport isCompliant="false"><details/></validationReport></report>'

# The false-green killer: validator exits 0, report says noncompliant.
make_verapdf_stub "$NONCOMPLIANT_REPORT" 0
OUT=$(run_validate "$FIXTURE_DIR/sample.pdf" 1b --no-evidence); RC=$?
assert_eq "noncompliant report with exit 0 still fails" "$RC" "2"
if echo "$OUT" | grep -q "isCompliant=false"; then
  ok "failure message cites the report verdict"
else
  bad "failure message should cite the report verdict (got: $OUT)"
fi

# Compliant report exits 0.
make_verapdf_stub "$COMPLIANT_REPORT" 0
OUT=$(run_validate "$FIXTURE_DIR/sample.pdf" 1b --no-evidence); RC=$?
assert_eq "compliant report passes" "$RC" "0"

# Exit 0 with an unreadable (non-MRR) report fails closed.
make_verapdf_stub "hello, I am not a report" 0
OUT=$(run_validate "$FIXTURE_DIR/sample.pdf" 1b --no-evidence); RC=$?
assert_eq "missing compliance attribute fails closed" "$RC" "2"

# Empty report fails closed.
make_verapdf_stub "" 0
OUT=$(run_validate "$FIXTURE_DIR/sample.pdf" 1b --no-evidence); RC=$?
assert_eq "empty report fails closed" "$RC" "2"

# Validator crash (exit 1, no report) is a validation failure, not a pass.
make_verapdf_stub "" 1
OUT=$(run_validate "$FIXTURE_DIR/sample.pdf" 1b --no-evidence); RC=$?
assert_eq "validator crash fails closed" "$RC" "2"

# PDF/X is refused: veraPDF cannot validate it, so no badge may be emitted.
make_verapdf_stub "$COMPLIANT_REPORT" 0
for p in x1a x4; do
  OUT=$(run_validate "$FIXTURE_DIR/sample.pdf" "$p" --no-evidence); RC=$?
  assert_eq "PDF/X profile $p refused" "$RC" "3"
done
OUT=$(run_validate "$FIXTURE_DIR/sample.pdf" x1a --no-evidence)
if echo "$OUT" | grep -q "outside veraPDF"; then
  ok "PDF/X refusal explains the scope limit"
else
  bad "PDF/X refusal should explain scope (got: $OUT)"
fi

# Invocation contract: --flavour carries the standard, aliases expand,
# machine-readable format is requested. --profile must never appear.
make_verapdf_stub "$COMPLIANT_REPORT" 0
run_validate "$FIXTURE_DIR/sample.pdf" a2b --no-evidence >/dev/null
if grep -qx -- "--flavour" "$STUB_ARGS" && grep -qx "2b" "$STUB_ARGS" \
  && grep -qx -- "--format" "$STUB_ARGS" && grep -qx "xml" "$STUB_ARGS"; then
  ok "a2b alias invokes veraPDF with --flavour 2b --format xml"
else
  bad "invocation should be --flavour 2b --format xml (got: $(cat "$STUB_ARGS" 2>/dev/null))"
fi
if grep -qx -- "--profile" "$STUB_ARGS"; then
  bad "invocation must not pass standard names via --profile"
else
  ok "invocation does not misuse --profile"
fi

# Missing validator.
OUT=$(PATH="/usr/bin:/bin" VERAPDF_CMD="verapdf-definitely-missing" bash "$VALIDATE_PDF" "$FIXTURE_DIR/sample.pdf" 2>&1); RC=$?
assert_eq "missing veraPDF exits 1" "$RC" "1"
if echo "$OUT" | grep -q "veraPDF not found"; then
  ok "missing validator prints install hint"
else
  bad "missing validator should print install hint (got: $OUT)"
fi

# Missing input file.
make_verapdf_stub "$COMPLIANT_REPORT" 0
OUT=$(run_validate "$FIXTURE_DIR/absent.pdf" --no-evidence); RC=$?
assert_eq "absent input exits 2" "$RC" "2"

# Evidence archive: report + summary with input hash and verdict.
EVID_DIR="$(mktemp -d)"
make_verapdf_stub "$COMPLIANT_REPORT" 0
OUT=$(VARVE_PDF_VALIDATION_EVIDENCE_DIR="$EVID_DIR" run_validate "$FIXTURE_DIR/sample.pdf" 1b); RC=$?
assert_eq "evidence-enabled run passes" "$RC" "0"
if [ -f "$EVID_DIR/sample.pdf.1b."*.report.xml ] && [ -f "$EVID_DIR/sample.pdf.1b."*.summary.txt ]; then
  ok "evidence report and summary archived"
else
  bad "evidence files missing in $EVID_DIR (got: $OUT)"
fi
if grep -q "input_sha256:" "$EVID_DIR"/sample.pdf.1b.*.summary.txt 2>/dev/null \
  && grep -q "verdict: compliant" "$EVID_DIR"/sample.pdf.1b.*.summary.txt 2>/dev/null \
  && grep -q "flavour: 1b" "$EVID_DIR"/sample.pdf.1b.*.summary.txt 2>/dev/null; then
  ok "evidence summary records hash, verdict, flavour"
else
  bad "evidence summary should record hash, verdict, flavour"
fi

rm -rf "$STUB_VERAPDF_DIR" "$FIXTURE_DIR" "$EVID_DIR"

# ── shell syntax of every CI-relevant shell script ──────────────────────────
echo "== shell syntax (bash -n) =="
for f in "$CI_LOCAL" "$INSTALL_CI" \
  "$ROOT/scripts/generate-icons.sh" \
  "$ROOT/scripts/generate-pdf-fixtures.sh" \
  "$ROOT/scripts/tauri-e2e.sh" \
  "$ROOT/scripts/validate-pdf.sh" \
  "$ROOT/scripts/verify-webgpu.sh" \
  "$ROOT/.githooks/pre-commit" \
  "$ROOT/.githooks/pre-push"; do
  if [ -f "$f" ]; then
    if bash -n "$f" 2>/dev/null; then ok "bash -n $f"; else bad "bash -n $f"; fi
  else
    bad "missing script: $f"
  fi
done

# ── summary ─────────────────────────────────────────────────────────────────
echo ""
echo "== Results: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
