# Security incident runbook

Companion to [SECURITY.md](../../SECURITY.md). Signing-key compromise stays
in [signing-incident-runbook.md](../release/signing-incident-runbook.md).
Privacy incidents stay in [privacy/runbooks.md](../privacy/runbooks.md).

One person maintains Varve. This runbook is written for that person, not
for a team that does not exist. Do the next necessary step. Do not invent
roles to fill.

Reports arrive by email at hello@varve.studio, or through GitHub private
vulnerability reporting.
TODO: a dedicated security@ alias may replace hello@ later.

## Intake

1. Read the report. Do not reply in public.
2. Open or accept a GitHub private advisory, or file a private note if the
   report arrived only by email.
3. Acknowledge within 3 business days. Say that you received it and when you
   expect a triage result.
4. Reproduce, or record why you cannot. Capture version, platform, and
   whether a shipped artifact is affected.
5. Assign severity. Write the CVSS vector you used, even if it is a first
   pass.
6. Decide: fix now, fix in the next release, or not a vulnerability.

If the report is a leaked credential, stop here and follow the signing
incident runbook or rotate the leaked secret first. A leaked updater key
is a critical incident even when no one has used it yet.

## Severity rubric

Use CVSS 3.1. Map the score to the [SECURITY.md](../../SECURITY.md) fix
targets:

| Severity | CVSS | Fix target after a confirmed fix |
|----------|------|----------------------------------|
| Critical | 9.0 to 10.0 | 7 days; aim to ship within 24 hours |
| High | 7.0 to 8.9 | 30 days |
| Medium | 4.0 to 6.9 | next release |
| Low | 0.1 to 3.9 | next release |

Treat these as critical even when the numeric score is lower:

- Remote code execution in a shipped desktop or website artifact
- A leaked signing, updater, or release credential
- A published installer that is not the bytes we attested

Do not inflate a local-only crash to critical because it is embarrassing.

## Who does what

There is no separate triage, comms, or release owner.

| Task | Who |
|------|-----|
| Acknowledge, triage, fix, test | The maintainer |
| Tag, run Release, publish the draft | The maintainer |
| Advisory and changelog | The maintainer |
| Tell users | The maintainer, through the advisory and changelog |

If you are unavailable, the report waits. That is an honest limit, not a
promise of backup coverage.

## Emergency hotfix

Goal: ship a critical fix within 24 hours of a confirmed fix. The existing
release machinery still applies. Do not invent a second publish path.

### Constraints you cannot skip

- `release.yml` Preflight refuses a tag whose commit is not an ancestor of
  `master`. A hotfix that lives only on a side branch cannot be tagged.
- The same Preflight and the Certified source gate require exact-SHA
  Release Candidate certification for that commit. Skipping
  `release-candidate.yml` will fail the release, not save time.
- Do not rewrite `apps/website/public/updates/stable.json` or
  `apps/website/src/data/release-manifest.json` for 0.5.x by hand. The
  Release workflow writes those files. A manual edit of a published 0.5.x
  feed is an incident of its own.

### Path

1. Branch from the **release tag**, not from current `master`.
   `git switch -c hotfix/0.5.x-security v0.5.x`
2. Apply the smallest change that closes the issue. Resist refactors.
3. Add a regression that fails without the fix. Run that spec, the affected
   compile, and the existing advisory or secret checks if they are in
   scope.
4. Merge the hotfix to `master` so the later tag is reachable from the
   default branch. Fast-forward if `master` has not moved; otherwise merge
   and keep the fix identical.
5. Freeze that exact `master` SHA. Run integration CI (`ci.yml`) on it.
6. Run `release-candidate.yml` on the same SHA. This is mandatory. It is
   the long pole; start it as soon as the SHA is frozen.
7. Run `pnpm release:prepare <X.Y.Z>` for the patch version. The changelog
   Security entry is the public notice, together with the advisory.
8. Create the immutable tag on the certified SHA. Let `release.yml` build
   the draft. For a Linux-only bug you may dispatch with
   `platforms: linux`; default is `all`.
9. Verify the fix on the built artifact for the affected platform.
10. Publish the draft (`publish=yes`). Website and updater feed updates
    come from that workflow.
11. Publish the GitHub Security Advisory. Tell affected users directly
    when you have a channel; do not rely on them noticing.

### Mandatory vs skippable checks

Mandatory before the tag:

- The exact regression
- Affected compile and unit checks
- `Pipeline validation (workflow + SHA pins)` if workflows, pins, or
  security scripts changed
- Integration CI on the exact SHA (`ci.yml`)
- Release Candidate certification on the exact SHA
  (`release-candidate.yml`)

Mandatory inside `release.yml`:

- Preflight
- Certified source gate
- Signing preflight
- Bundle for every platform you will publish
- Verify (checksums, SBOM, attestations, signing policy)
- Draft, then Publish

Skippable while you are writing the fix, and skippable as extra local
lanes. They are not substitutes for Release Candidate:

- Visual baselines (`visual-baselines.yml`)
- Website Lighthouse (`website-lighthouse.yml`)
- Model validation (`model-validation.yml`)
- WebGL2 qualification (`webgl2-qualification.yml`)
- Keyboard-nav E2E (`e2e-keyboard-nav.yml`)
- Full Playwright product E2E, unless the vulnerability is in that UI
- Website E2E, unless the vulnerability is on the website
- Benchmark corpus
- Coverage jobs

Release Candidate still runs its own website, browser, visual, native,
model, and bench lanes when the candidate planner selects them. Do not
delete those jobs for an emergency. If a candidate lane is already green
for this SHA from a prior run, the candidate workflow's existing reuse
rules apply; do not fake a receipt.

### Expected time

From a confirmed fix on a hotfix branch to a published draft:

| Step | Typical |
|------|---------|
| Regression + merge to `master` | 30 to 90 minutes |
| Integration CI | 30 to 90 minutes, often overlaps RC |
| Release Candidate | 3 to 8 hours |
| `release.yml` build and verify | 1 to 3 hours (longer with macOS and Windows) |
| Human publish + advisory | 15 to 30 minutes |

The 24-hour target is possible when RC is started immediately and you do
not wait on visual or Lighthouse extras outside that workflow. It is not
possible if you skip RC and hope Preflight will let it through.

## Updater feed

For 0.5.x, `stable.json` and `release-manifest.json` change only through
the normal Release workflow after a published tag. Do not:

- Rewrite either file to hide a bad release
- Point the feed at a commit that was never released
- Copy a previous feed over a new one by hand

If a published 0.5.x release is worse than the previous one, follow
[release-rollback-runbook.md](../release/release-rollback-runbook.md).
Mark the bad release, keep it downloadable, and let the documented
rollback path re-point the website.

## Advisory template

```md
# [Title]: [one-line impact]

CVE: (request or assign when publishing)
Severity: Critical | High | Medium | Low (CVSS 3.1: X.X, vector)
Affected: Varve 0.5.x through 0.5.Y (desktop / website / both)
Fixed in: 0.5.Z
Reported by: [name or "reported privately"]

## Impact

[What an attacker can do, on which artifact, without exaggeration.]

## Mitigation

Update to 0.5.Z. Verify the installer:

    gh attestation verify <file> --repo varvedesign/varve

For 0.5.1 and earlier, use `--repo K-Arthur/varve` or `--owner K-Arthur`.

## References

- Changelog: CHANGELOG.md [0.5.Z]
- Commit: [sha]
```

## Post-incident review template

Fill this in after the advisory is public. Keep it in the private advisory
or a private note. Promote a redacted copy to
`docs/audits/` only if it teaches something durable.

```md
# Post-incident review: [advisory id or title]

Date detected:
Date fixed on master:
Date released:
Severity:

## What happened

## What we missed

## What we will change

- Detection:
- Tests:
- Release path:
- Nothing (say so if the process was fine):

## Time spent

- Intake to triage:
- Confirmed fix to published release:
- Missed the 24-hour critical target? Why:
```
