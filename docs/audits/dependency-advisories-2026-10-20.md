# Dependency advisories — 2026-10-20

The hosted pipeline for responsive PR #153 failed its dependency advisory job
on 2026-10-20 after its UI checks had passed locally. The downloaded CI report
identified three production npm advisories in Vite 8.2.1, four findings in the
root Cargo lockfile, and two in the Tauri Cargo lockfile. Both lockfiles in the
CI report matched the local checkout byte for byte. This is a dependency-graph
repair on a separate branch so the responsive UI diff remains focused.

| Evidence | Dependency path | Decision |
| --- | --- | --- |
| [Vite GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | Astro → Vite 8.2.1 in the website production graph, plus desktop/tooling peers | Resolve Vite 8.2.4 across the workspace and raise the desktop direct dependency floor. |
| [RUSTSEC-2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382.html) | `rustls-webpki` 0.103.15 through `rustls` | Update both Cargo lockfiles to 0.103.16. |
| [RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html), [RUSTSEC-2026-0381](https://rustsec.org/advisories/RUSTSEC-2026-0381.html) | `webpki-root-certs` 1.0.9 and `webpki-roots` 1.0.9; root graph also had the [0.26.11 compatibility re-export](https://github.com/rustls/webpki-roots/releases) through `diffusion-rs` → `hf-hub` 0.4 → `ureq` 2 | Update the 1.x certificates to 1.0.10. Raise the vendored helper to `hf-hub` 0.5, whose [published manifest](https://docs.rs/crate/hf-hub/0.5.0/source/Cargo.toml) uses `ureq` 3, removing the 0.26 compatibility package. |

## Verification

- `pnpm audit --prod --audit-level=low --json`: zero vulnerabilities.
- `cargo audit --file Cargo.lock --json` and `cargo audit --file apps/desktop/src-tauri/Cargo.lock --no-fetch --json`: zero vulnerabilities. Both retain only the gate's informational warnings.
- `node scripts/security/dependency-advisories.mjs`: all three scopes pass with no ignore configuration.
- `cargo check -p varve-generative-helper --locked`: passes, including the vendored `diffusion-rs` API with `hf-hub` 0.5.
- `pnpm --filter @varve/desktop typecheck`: passes; `pnpm exec vitest run apps/desktop --maxWorkers=2 --reporter=dot`: 15 files and 90 tests pass.
- `pnpm --filter @varve/website build`: 126 pages build after a clean 200-file Astro check.
- `pnpm --filter @varve/desktop build`: passes with Vite 8.2.4. Existing browser-compatibility and chunk-size warnings remain visible in the build output.

`pnpm verify:plan` requires the full gate for this workspace/toolchain change;
`pnpm verify:affected` exits at that escalation before running its selected
lanes. Full hosted certification is required before merging the dependency
branch.
