# Security Policy

## Reporting a vulnerability

Report security issues privately. Do not open a public GitHub issue, and do
not publish details before a coordinated disclosure.

Use either channel:

1. Email [hello@varve.studio](mailto:hello@varve.studio)
2. GitHub private vulnerability reporting: Security tab, then
   [Report a vulnerability](https://github.com/varvedesign/varve/security/advisories/new)

Do not include unnecessary personal data or destructive test results.

## Response times

These are targets, not guarantees. One person maintains this project.

| Step | Target |
|------|--------|
| Acknowledgement | within 3 business days |
| Triage and severity (CVSS) | within 7 days of acknowledgement |
| Critical fix | 7 days after a confirmed fix is identified |
| High fix | 30 days after a confirmed fix is identified |
| Medium and low | the next release |

If you do not get an acknowledgement, follow up on the same private channel.

## Coordinated disclosure

We follow coordinated disclosure. The default window is 90 days from the
acknowledgement. We may ask for more time when a fix is not ready; we may
agree to a shorter window when the risk of holding back is worse than
publishing.

Public details wait until a fix is available, or until the agreed window
ends. We credit reporters who want credit.

## Supported versions

During the public 0.5 beta, only the latest 0.5.x release receives security
fixes. Older 0.5.x builds, prereleases, and unreleased `master` are not
supported for patching. `master` still accepts fixes as source.

## How fixes are announced

- A GitHub Security Advisory for the issue
- A `CHANGELOG.md` entry under Security for the release that contains the fix

We do not promise additional notification channels.

## How to verify a release

Published artifacts include SHA-256 checksums and an SBOM. Attestations are
verified with the GitHub CLI.

Current repository:

```bash
gh attestation verify <file> --repo varvedesign/varve
```

Releases through 0.5.1 were attested under the previous repository name.
For those files use either:

```bash
gh attestation verify <file> --repo K-Arthur/varve
```

or, equivalently, owner scope:

```bash
gh attestation verify <file> --owner K-Arthur
```

`gh attestation verify` requires `--repo OWNER/REPO` or `--owner OWNER`.
`--repo` is the tighter check. See `gh attestation verify --help`.

Unsigned installers, when the release policy allows them, are labelled as
unsigned. Checksums and attestations still apply to the published bytes.

## What to include

- A clear description of the vulnerability
- Steps to reproduce, if you have them
- The version(s) affected
- Impact you have already identified

## Scope

In scope:

- The Varve application code (Rust, TypeScript)
- Build and distribution infrastructure (GitHub Actions, the release and
  signing pipeline, the website deployment)
- Authentication and authorisation mechanisms, if any exist

Out of scope:

- Third-party dependencies (report those to their maintainers)
- Vulnerabilities in the Rust or Node.js ecosystems (report upstream)
- Theoretical attacks without a practical impact

## Handling process

1. Acknowledge the report through the advisory or security email.
2. Triage: confirm severity (CVSS), affected versions, and whether a fix is
   feasible.
3. Fix and release: the fix lands on `master`, then in a supported 0.5.x
   release. Critical issues follow
   [docs/security/incident-runbook.md](docs/security/incident-runbook.md).
4. Disclose through a GitHub Security Advisory and the changelog, then
   credit the reporter unless they ask to stay anonymous.

## Supply-chain and secret handling notes

- A compromised credential (signing key, token, CI secret) is treated as
  compromised even if the exposure was private or masked; see
  `docs/security/security-hardening.md` → Credential compromise response.
- The Tauri updater signing key is an active release-security asset: losing or
  leaking it affects every installed client that trusts it. It is separate
  from Windows and macOS platform-signing credentials. See
  `docs/release/update-strategy.md` and the signing incident runbook.
- All third-party GitHub Actions are pinned to full commit SHAs and the
  pin table is verified in CI (`scripts/pin-github-actions.mjs`).
- Secret scanning is enabled on this repository (repository settings);
  suspected leaked credentials should be reported through an advisory
  even if GitHub's scanning has already flagged them.

## Known dependency advisories and mitigations

The repository is checked against the GitHub Dependabot API and the resolved
dependency graphs. On 2026-10-02, `pnpm audit --prod` reported no production
vulnerabilities, `cargo audit` reported no Rust vulnerabilities in either
Cargo workspace, and GitHub reported one open development-only advisory
(extract-zip), which has no upstream fixed release and is mitigated locally.

### Dependency advisory snapshot (2026-10-06)

This records the API and lockfile state observed on that date. It is not a
live advisory feed; check the current scanners and provider alerts before using
it for a new release decision.

The refreshed API inventory contains three open development-tool alerts:
`extract-zip` (#46, high), `postcss-selector-parser` (#106, moderate), and
`smol-toml` (#108, moderate). `http-cache-semantics` now resolves to the upstream
fix, 4.3.0; its earlier local backport was removed and alert #105 is closed.
Stylelint resolves the fixed selector parser 7.1.6, and production Astro
resolves fixed `smol-toml` 1.9.0. `pnpm why --prod smol-toml postcss-selector-parser`
shows only that fixed TOML parser in the production graph.

The remaining selector parser 6.1.4 belongs to Tailwind 3/postcss-nested website
build tooling. Older TOML parser 1.7.1 copies belong to Knip and WDIO native
test tooling. They parse repository-controlled build/test configuration; no
direct application or website-client import consumes customer selectors or
TOML through these modules. The [selector advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)
explicitly excludes ordinary build-time use on trusted sources. The
[TOML advisory](https://github.com/advisories/GHSA-r4xh-jqrq-34v2)
requires parsing attacker-supplied TOML. This reviewed exposure does not mean
the older versions are patched: retain their raw alerts and verify compatibility
when updating those development consumers. Do not dismiss them or change the
immutable release's lockfile mid-build. The `extract-zip` containment mitigation
and its malicious-archive runtime checks remain required.

### Earlier release findings (2026-10-03)

The release review found two high npm findings with no published upstream
fixed versions: `http-cache-semantics@4.2.0` and `braces@3.0.3`, both in the
website build dependency graph, and two open high GitHub Dependabot alerts:
`http-cache-semantics` (alert #105) and development-only `extract-zip@2.0.1`
(alert #46). The repository carries reviewed local mitigations for all three
packages. Runtime and consumer regression tests cover those mitigations;
the raw advisories and GitHub alerts remain visible and are not described as
upstream-resolved. See the detailed scanner, patch, and test contract in
[`docs/CI_CD_RESILIENCE.md`](docs/CI_CD_RESILIENCE.md).

The desktop Cargo audit still reports the unsound `glib@0.18.5`
`VariantStrIter` advisory through the Linux GTK stack, plus unmaintained
dependency warnings. It remains visible as a release risk; a clean scanner
exit is not evidence that these upstream warnings are fixed.

Two Cargo workspaces exist and must be audited separately: the root
`Cargo.lock` covers `crates/`, while `apps/desktop/src-tauri/Cargo.lock` is a
standalone workspace that carries the Tauri, wry, tao, and gtk-rs stack.
Neither is a subset of the other. `.github/dependabot.yml` has a Cargo entry
for each directory; run `cargo audit` from each root before a release.

CI and the final release candidate run the read-only dependency advisory gate
inside their existing preflight jobs. It checks production npm dependencies,
including optional dependencies, and both Cargo lockfiles. Reported
vulnerabilities fail the gate; registry/database failures remain nonpassing
external blockers. RustSec informational warnings, including the unresolved
glib unsoundness and unmaintained crates below, are retained in the sanitized
reports and logs rather than ignored or described as fixes. These warnings
remain dependency risk for release review.

- **[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) (CVE-2026-19693) and GHSA-jmr9-qjv8-65gv —
  extract-zip 2.0.1 (npm, dev-only)**. A crafted archive plants a symlink and
  then writes a later entry through it, escaping the destination directory
  (path traversal, CWE-22; CVSS 8.1 for the CVE). No patched release exists
  on npm — 2.0.1 remains the latest published version — so the mitigation is a
  pnpm patch, `patches/extract-zip@2.0.1.patch`. It rejects absolute and
  out-of-tree symlink targets on creation and refuses to write a regular entry
  through an existing symlink leaf (matching upstream PR #160).

  Exposure is development-only. The package enters solely through
  `@wdio/utils -> @puppeteer/browsers`, which the dev/test toolchain uses to
  download official browser binaries. This is tooling exposure, and the code
  path is not used in a shipped application. Official download endpoints do
  not replace archive containment checks. Enforcement has two layers:
  `scripts/security/dependency-hardening.test.mjs` pins the lockfile patch
  hash and the contract of the patch text;
  `scripts/security/extract-zip-containment.test.mjs` builds the malicious
  archives in memory, loads the exact module the lockfile resolves, and
  asserts an outside canary is never touched (with positive controls so the
  patch cannot over-block ordinary archives). Alert 46 remains open because
  the local mitigation is not an upstream fix; alert 37 was previously
  dismissed as a tolerable risk. Re-check on each alert review and on any `@wdio/*` or
  `@puppeteer/browsers` upgrade. Note that a bare `pnpm audit` still reports
  this package: its scanner does not evaluate local patch files. That is
  expected and must not be described as an upstream fix.

- **GHSA-ggr8-5vv4-36mx — deepmerge-ts 7.1.5 (npm, dev-only)**. Recursive
  object graphs can exhaust the stack. WDIO still declares the vulnerable
  7.x range, so the workspace pins the compatible patched 8.0.0 release via
  a documented override. The resolved graph no longer contains 7.x; remove
  the override when WDIO widens its dependency range.

- **[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) (GHSA-wrw7-89jp-8q8g) — glib 0.18.x (cargo, desktop runtime)**.
  Unsoundness in `Iterator`/`DoubleEndedIterator` impls for
  `glib::VariantStrIter`; fixed in glib 0.20.0. The whole gtk-rs 0.18 stack
  (gtk/gdk/gio/pango/atk, pulled by `tao`, `wry`, `tray-icon`, `tauri`)
  remains in the resolved Tauri 2.11.x dependency chain. Replacing this stack
  requires a compatible upstream migration and native validation. It lives
  in the `apps/desktop/src-tauri` workspace, not the root `crates/` graph, and
  remains an unsoundness warning in the audit. Varve has no direct
  `VariantStrIter` calls; that alone does not prove the absence of indirect
  dependency exposure. Re-evaluate when Tauri adopts a compatible fixed stack.
