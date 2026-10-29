# GitHub repository presence

This is the maintenance note for Varve's public GitHub surface. It records
the canonical identity, the assets used by the repository page, and the small
set of GitHub settings that cannot be represented in git.

## Canonical identity

| Field | Value |
|---|---|
| Repository | `varvedesign/varve` |
| Website | <https://varve.studio> |
| Source repository | <https://github.com/varvedesign/varve> |
| Application release shortcut | <https://github.com/varvedesign/varve/releases/latest> |
| Current public status | Public beta; latest published application release is `v0.5.1` (published 2026-10-16) |
| License wording | Source-available under FSL-1.1-MIT; not OSI-approved open source |

The repository description is a short product definition rather than a
slogan. Keep it keyword-first so GitHub search and link previews index the
disciplines and platforms (set via Settings → General → description, or
`gh api -X PATCH repos/varvedesign/varve -f description=...`):

> Varve · Free local-first design suite: vector, layout, typography, motion, prototyping, comics, photo & print. No account, no subscription. Linux, Windows & Apple Silicon Mac.

The current topic set is intentionally limited to product and implementation
terms (20 topics, the GitHub cap): `cmyk`, `comics`, `cross-platform`,
`design-editor`, `design-tool`, `desktop-app`, `graphic-design`,
`illustration`, `linux`, `local-first`, `motion-design`, `photo-editor`,
`print-design`, `prototyping`, `rust`, `source-available`, `tauri`,
`typography`, `vector-graphics`, and `webassembly`. `vector-editor` was
dropped in favor of `cross-platform`.

If the product stage or latest published release changes, update the source
of truth first (`packages/shared/src/product.ts` and the generated website
release manifest), then refresh the README and `public/llms.txt` statements.

## Brand and social preview

The canonical repository-facing mark is the Varve wordmark in
`packages/ui/src/icons/varve-wordmark.svg` and its dark-theme counterpart
`varve-wordmark-dark.svg`. The application mark and favicon use the same
identity; do not create a second repository-only logo.

The social card is the generated 1200×630 PNG at
`apps/website/public/og-image.png`. Regenerate it from
`scripts/screenshots/og-template.html` with:

```bash
pnpm screenshots:og
```

It is also the website's Open Graph image, which keeps link previews and the
repository page visually consistent.

Card layout (redesigned 2026-10-29): the left column carries the full Varve
lockup (outlined wordmark inlined from `varve-wordmark-dark.svg`, so no
font is needed for the brand), the "Local-first design suite" eyebrow, the
"Design across disciplines. / One canvas." headline set in Geist with the
accent line in brand teal, the discipline line, and two chips (platforms;
"No account · No subscription"). The right side shows the deterministic
`docs/screenshots/product/workspace-dark.png` screenshot in window chrome
(a dots-only title strip — no window title text, because the screenshot's
own title bar already names the document) that deliberately bleeds past the
right canvas edge (window left 664, width 600 on a 1200px canvas). A
teal-outlined "Public beta" pill straddles the window's top-right corner;
it states `PRODUCT_STATUS.stage`, not a version, so it does not go stale
between releases. `varve.studio` anchors the bottom-left, "Free &
source-available" the bottom-right, and a three-band brand ribbon
(teal/sandstone/terracotta) closes the bottom edge. Inputs are local only
(the website's Geist font from node_modules plus the tracked screenshot);
render makes no network requests. When editing the template, keep text
inside the left column (the screenshot window starts at x=664), keep live
text at least 40px from the top/bottom edges (GitHub may center-crop the
social preview toward 2:1, trimming roughly 15px per edge), and re-render
to verify before uploading.

The square 512×512 repository/owner icon is
`docs/brand/github-repository-icon.png`. It is generated from the canonical
`packages/ui/src/icons/varve-app-icon.svg` master with:

```bash
rsvg-convert -w 512 -h 512 packages/ui/src/icons/varve-app-icon.svg \
  -o docs/brand/github-repository-icon.png
```

GitHub does not expose a normal per-repository avatar setting: the small icon
shown beside a repository name is the owner or organization avatar. Use this
PNG for a Varve organization avatar, or for the K-Arthur profile only if
changing the profile avatar for every repository is intentional. The README
hero and social preview provide repository-specific branding without changing
the account identity.

## GitHub settings that are not stored in git

Verify these after a repository transfer, domain change, or major release:

1. **GitHub → Settings → General → Repository details**
   - Description: use the canonical description above.
   - Website: `https://varve.studio`.
   - Topics: use the maintained list above; remove stale product names or
     competitor names.
2. **GitHub → Settings → General → Social preview**
   - Upload `apps/website/public/og-image.png`.
   - Re-upload after a deliberate redesign; the file in the repository is the
     reproducible source for the intended card.
3. **GitHub → Settings → Features**
   - Keep Issues and Discussions enabled.
   - The current discussion categories are Announcements, General, Ideas,
     Polls, Q&A, and Show and tell. Link a category only when it is intended
     for that kind of post.
4. **GitHub → Settings → Code security and analysis**
   - State verified 2026-10-28: secret scanning and push protection were
     disabled and are now enabled; private vulnerability reporting is enabled
     (a `GET` on
     `/repos/varvedesign/varve/private-vulnerability-reporting` returns
     `{"enabled":true}`); Dependabot security updates was already enabled;
     non-provider patterns and validity checks remain disabled.
   - REST state reads from `GET /repos/varvedesign/varve` under
     `security_and_analysis`. Enabling the two scanning flags requires a
     `PATCH` whose body nests `secret_scanning` and
     `secret_scanning_push_protection` under a top-level
     `security_and_analysis` object with `"status": "enabled"` each; flat
     top-level fields are accepted but silently ignored.

GitHub-generated community health checks may not recognize uncommitted local
templates. After `.github/ISSUE_TEMPLATE/` and
`.github/PULL_REQUEST_TEMPLATE.md` are merged, re-open the Community Standards
view to confirm that GitHub recognizes them.

## Public-content rules

- Say **public beta**, not stable, until `PRODUCT_STATUS.stage` changes.
- Call the current license **source-available**, not open source.
- Treat the latest published application release (currently `v0.5.1`) as the latest
  until GitHub publishes a newer `vX.Y.Z` release. `varve-models-v1` is an auxiliary
  model-artifact release and must not be presented as an application download.
- Keep privacy wording scoped to core editing. Model downloads, online
  font/icon providers, user-configured remote providers, update checks, and
  consented aggregate analytics are distinct network features.
- Historical pre-rename references belong only in migration, file-format, and
  dated engineering documentation; current product copy should say Varve.
