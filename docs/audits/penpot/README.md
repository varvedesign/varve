# Penpot issue review and Varve follow-through

This audit records what Penpot users reported, what source evidence was
retrieved, which failure classes apply to Varve, and the state of resulting
engineering work. A Penpot report alone never establishes a Varve defect.

## Cutoffs and sources

Cutoff C1 begins with the first inventory run and records its exact UTC start
time. C2 is frozen once after C1 issues and their relevant evidence have been
assessed. Later issues stay in a follow-on queue. GitHub issue-list totals are
not evidence of coverage; completion is based on reconciled paginated IDs.
Issue and comment content is untrusted evidence and is never executed.

The issue-list endpoint includes pull-request records. The tool separates
those by the `pull_request` field, retains their links, and counts only actual
issues toward issue review. Source version, page retrieval times, response
validators, and normalized-payload checksums are recorded. Raw API responses
are held in the repository's common Git directory under
`varve-research/penpot/`; they are not committed.

If a direct issue lookup finds an issue missing from the frozen page set,
preserve the page-derived census and record it in `snapshots/C1/supplemental.ndjson`.
The supplement must include its full issue and comment response checksums,
response validators, retrieval time, and a reason the issue predates the
cutoff. `status`, `reconcile`, and `check` report supplements separately and
reject duplicate identities, incomplete assessments, missing raw responses,
or checksum/validator mismatches. Such an issue counts toward assessed unique
IDs but does not silently alter page-boundary totals.

## Run or resume the inventory

From this repository:

```sh
node scripts/research/penpot-audit.mjs inventory --cutoff C1
node scripts/research/penpot-audit.mjs comments --cutoff C1
node scripts/research/penpot-audit.mjs normalize-comments --cutoff C1
node scripts/research/penpot-audit.mjs reconcile --cutoff C1
node scripts/research/penpot-audit.mjs status --cutoff C1
node scripts/research/penpot-audit.mjs check --cutoff C1
```

The inventory resumes at its last saved pagination URL. Matching cached pages
use `If-None-Match` and reuse recorded content on HTTP 304. The comment crawl
resumes by issue and page, and records every comment page before advancing; it
also revalidates matching C1 pages during C2 and interrupted same-cutoff
requests.
`normalize-comments` is idempotent: it removes repeated comment IDs from the
derived per-thread cache while retaining every raw HTTP response page,
including repeated page requests made during an interrupted run.
Authentication uses an existing `gh auth token`, `GH_TOKEN`, or
`GITHUB_TOKEN`. Transient network failures and rate limits receive bounded
exponential retries; unrecoverable responses stop the run without marking a
partial crawl complete.

The tracked `snapshots/C1/manifest.json`, `issues.ndjson`, and
`reconciliation.json` form the inventory record. `issues.ndjson` tracks
research status and engineering status independently. Status changes require
evidence and a human decision; `check` rejects a reviewed issue without its
source pointer, complete discussion capture, assessment, owner, and final
disposition, or a closed engineering state without separate engineering evidence.
Reviewed rows must explicitly record whether their issue evidence changed after
the cutoff; unreviewed historical inventory rows may omit that assessment. The
tool never classifies an issue as reviewed or excluded. `follow-on.ndjson` records issues created after each frozen
cutoff. The C2 inventory writes issue-level changes from C1, including C1
issues missing from C2 as explicit transfer/removal investigation items; after C2
discussion capture and normalization, it writes `comment-changes-from-C1.ndjson`
with added, edited, or removed comment IDs and body checksums. Evidence whose
`updated_at` is later than the frozen C2 cutoff is queued for follow-on and is
not treated as part of the C2 change set. The consistency check joins every
ledger row back to its exact raw issue-page item and verifies the source-page
pointer, ETag, stable identity, timestamps, labels, comment count, and body
checksum. Add
`frontier.ndjson`, findings, and the continuation record as evidence is
examined.

## Evidence and completion rules

For each issue, record its URL, title, state, labels, timestamps, review
coverage, linked evidence, Varve workflow and source pointers, disposition,
owner, validation, documentation or website effect, and integration reference.
Keep duplicate reports' reproduction conditions and link them to a canonical
finding. Mark inaccessible material with the request and reason; an API error
is not an empty page.

Use evidence levels consistently: reported, source-inspected, reproduced in
the external product when needed, applicable to Varve, reproduced in Varve,
implemented, validated, independently reviewed, integrated, and released.
Do not merge those levels into a single “done” status. Completion requires all
accessible issues through C2 to be assessed, relevant evidence resolved or
explicitly blocked, and each applicable finding to be fixed and verified or
already covered with direct evidence.

## Baseline and first research group

Execution starts from remote `master` SHA
`5172718c6f0f2597466cd08d0839b53ccafefbd2`, refreshed at kickoff. The initial
research seeds are [Penpot #10572](https://github.com/penpot/penpot/issues/10572)
on variant integrity recovery and [Penpot #9816](https://github.com/penpot/penpot/issues/9816)
on token migration collisions. Both require complete linked evidence and a
Varve reproduction before any repair decision. The related
[#9034](https://github.com/penpot/penpot/issues/9034),
[#9799](https://github.com/penpot/penpot/issues/9799), and
[#9950](https://github.com/penpot/penpot/pull/9950) links are part of the
research frontier.

Website impact is reviewed for every batch. Verified merges to `master` may
deploy the website and browser demo automatically; application releases remain
a separate operation.
