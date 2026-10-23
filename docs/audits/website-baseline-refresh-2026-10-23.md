# Website baseline refresh — 2026-10-23

Scope: thirteen inspected snapshots of already-committed website content and
styles, based on `f607059a7918a341a6c784d76fdc10428c08b706`. Screenshot tolerances
and test assertions are unchanged.

## Review

| Snapshots | Accepted source-backed difference |
| --- | --- |
| Background removal: light desktop and dark mobile, both deployment paths | Committed memory guidance, current Varve footer and absent analytics prompt; four images. |
| Hero light, hero eyebrow light, product light/dark | Existing 12px micro-label floor changes CTA dimensions and page height; four images. |
| Linux download light | Committed label/type floors and current configured mono fallback; commands remain uncut. |
| Chromebook light | Published version is now 0.5.0; route comparison remains intact. |
| Lower-memory performance light | Committed threaded-image-tracing/isolated-deployment guidance adds a paragraph. |
| Features dark | Registered real-time collaboration card and current footer. |
| Typography light | Expanded Unicode vertical-orientation and tate-chu-yoko guidance, capability text and current mono stack. |

The actual expected/actual/diff images were inspected before acceptance.
Relevant preceding commits include `6f05b6a79`, `b12cfd669`, `b31ca1e8f`,
`45f54ed29`, `5e58ce0c0`, `70b0caec4`, `ce734e62e` and `b0fffcec2`.
Original baseline bytes remain in Git. Local detailed review, image comparisons,
before/after SHA-256 manifest and terminal receipts are retained in the common
Git directory under `shell-home-evidence/20261023/website-snapshot-review/`
and `website-baseline-recovery.{json,log,exit}`.

## Validation record

- Changed scope: four PNGs in `background-removal-feature.spec.ts-snapshots`,
  nine PNGs in `visual.spec.ts-snapshots`, and this record.
- Plan: `pnpm verify:plan --staged` selects nine lanes (eight commands):
  touched format/lint, emoji/docs, website E2E/compiler/unit checks and the two
  owning browser specs; no full-suite escalation. The prior affected run's website lane had 710
  passing cases, thirteen snapshot mismatches and five screenshot-protocol errors.
- Exact targeted command actually run (exit 0, thirteen cases passed):

```sh
node scripts/quality/heavy-lease.mjs "website: thirteen reviewed baseline checks" -- pnpm exec playwright test --config playwright.website.config.ts apps/website/tests/e2e/background-removal-feature.spec.ts apps/website/tests/e2e/visual.spec.ts --grep 'background-removal feature page is accurate and usable on mobile|background-removal guidance is readable on a light desktop|hero light$|hero eyebrow stays contained across viewport sizes \(light\)$|download page linux guidance light$|chromebook route chooser page light$|lower-memory performance page light$|features page dark$|typography page light$|theme matrix screenshots.*product (light|dark)$' --workers=1 --reporter=list
```

- Reused the same existing builds; only the thirteen reviewed expected images
  changed. Each original and replacement hash was checked against the manifest.
- Retain the 710 unchanged passes. The five protocol-error recoveries are a
  separate pending obligation; this checkpoint does not claim aggregate green.
- `git diff --cached --check` and `pnpm audit:docs` passed for this checkpoint.
  Existing affected compiler/unit evidence is retained; changing PNGs and this
  record does not invalidate it.
- Skipped as unrelated: Rust/native and editor functional suites for this
  baseline-only checkpoint. Full suite run: no; no escalation for this scope.
- This is local browser evidence, not hosted release or native-engine certification.
