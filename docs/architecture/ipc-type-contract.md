# Varve Rust <-> TypeScript IPC type contract

**Status:** current-state seam contract, measured 2026-10-28 (Home module
split and tags group included). Guard: `pnpm audit:ipc`
(`scripts/quality/audit-ipc-contract.mjs`). Allowlists live in
`scripts/quality/ipc-contract-allowlists.mjs`. Regression tests:
`scripts/quality/audit-ipc-contract.test.mjs`.

Varve's desktop frontend talks to the native Rust process over Tauri IPC. This
document records the seam as it is, the part the new audit enforces, the part it
does not, the rules for changing the seam, and the staged move to generated
bindings.

## Summary

- **154** `#[tauri::command]` functions in 15 Rust files, all registered in
  `lib.rs`'s `generate_handler!`.
- **191** literal TypeScript `invoke()` call sites in 31 files, naming **172**
  unique commands: **124** resolve to a Rust command, **48** are known
  pre-existing gaps (Home Phase 1-3, below), **0** are new drift.
- **4** dynamic-name call sites are explicitly allowlisted; **5** plugin
  namespaced names (`plugin:dialog|open` and friends) are ignored as non-custom
  commands.
- **30** Rust commands are never literally invoked from TypeScript (reached
  dynamically, through adapters, or unused); reported for information, not failed.
- **0** generated bindings. `specta` / `tauri-specta` are absent from every
  manifest. Argument and return shapes are hand-mirrored, and 56 Rust command
  parameters are JSON strings (`*_json: String`) that TypeScript serializes by
  hand.

## Current seam inventory

### Rust command modules

| File | Commands | Role |
|------|----------|------|
| `apps/desktop/src-tauri/src/lib.rs` | 69 | engine/IR, sync store, clipboard, AI inference, models, trace/upscale, print, stubs |
| `home_store/documents.rs` | 25 | Home file/project CRUD, app settings, Home view state |
| `home_store/library.rs` | 15 | Home thumbnails, search, recent files, on-disk text IO |
| `home_store/tags.rs` | 8 | workspace tags and file-tag associations (schema v3) |
| `collab_host.rs` | 7 | collaboration host start/stop, rooms |
| `font_storage.rs` | 6 | font filesystem storage |
| `crash.rs` | 4 | crash report files |
| `lifecycle.rs` | 4 | close/exit approval, shutdown markers |
| `native_tensors.rs` | 4 | native tensor sessions |
| `acceleration.rs` | 3 | GPU capability/status |
| `native_raster.rs` | 3 | native raster frames |
| `font.rs` | 2 | system font enumeration/load |
| `menu.rs` | 2 | native menu build/update |
| `file_open.rs` | 1 | OS file-association intake |
| `updates.rs` | 1 | updater context |
| **Total** | **154** | registered in `generate_handler!` |

### Rust wire structs

`crates/varve-bridge/src/lib.rs` is the only dedicated wire layer: six
`serde`-derived types - `IpcSceneNode`, `IpcShape`, `IpcTextShape`,
`IpcEngineFill`, `IpcEngineImageFillData`, `IpcEnginePatternFillData` - plus
`convert_engine_nodes` / `parse_engine_nodes_json`. It is shared by Tauri IPC and
the WASM build (ADR-0004). Everything else is defined next to its command.

The bridge is not fully typed at its boundary. `IpcSceneNode` carries
`serde_json::Value` fields (`cornerRadius`, `filters`, `richText`,
`openTypeFeatures`, `variableAxes`, `pathTextSettings`), and several commands
accept pre-serialized JSON (`nodes_json`, `options_json`, `manifest_json`,
`request_json`). Sixteen Rust source lines across `lib.rs` (5), `collab_host.rs`
(7), `inference_models.rs` (1), and `print_windows.rs` (3) reference
`serde_json::Value` directly.

### TypeScript call sites

| Area | Sites | Notes |
|------|-------|-------|
| `packages/platform/src/tauri.ts` | 116 | the desktop `Platform` adapter: Home file store, dialogs, thumbnails, clipboard, settings. 48 of its commands are the known gaps |
| `packages/platform/src/hostMemory.ts` | 1 | `host_memory_status` |
| `packages/engine` (18 files) | 48 | native providers: upscale, background removal, trace, generative edit, media probe/decode, fonts, inference worker, acceleration, text shaping |
| `packages/editor` (8 files) | 20 | share/collab, crash report files, native raster client, native menu adapter, PDF/X spec export |
| `apps/desktop` (4 files) | 5 | lifecycle bridge, OS file open, reveal window, updater |
| `packages/print/src/native.ts` | 1 | PDF export transport |
| **Total** | **191** in 31 files | 172 unique command names |

Two dynamic transports are injected ports rather than command-name switches:
`packages/engine/src/font/fontStorageFs.ts` (`tauriInvoke(cmd, args)`) and
`packages/engine/src/shapingBackend.ts` (an injected `NativeShapeInvoker` whose
default implementation has the literal command). Two more select among fixed
export commands: `packages/editor/src/components/SpecPanel/export.ts` and
`packages/print/src/native.ts`. All four are allowlisted with reasons and a
one-site budget; a new dynamic site fails until reviewed.

### Hand-mirrored payloads (the remaining hole)

The invoke wrapper itself is untyped. Examples:

- `packages/engine/src/engine.ts`: local `TauriCore` type
  `{ invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }`;
  `build_render_ir` passes `scene.nodes` with `as RenderItem[]` only after the
  return crosses the boundary.
- `packages/platform/src/tauri.ts`: its own `TauriCore` interface and
  `as FileEntry[]` / `as Project[]` / `as Permission[]` casts on every result.
- `packages/engine/src/shapingBackend.ts`: `NativeShapeWireRequest` (snake_case)
  is hand-mirrored into `request_json` for `varve_print::shaper::ShapeRequest`.
- `packages/editor/src/components/SpecPanel/export.ts` and
  `packages/print/src/native.ts`: a hand-built options object is stringified into
  `optionsJson` and deserialized into `PdfXOptions` in `lib.rs`.
- `packages/engine/src/inference/nativeWorkerBridge.ts`: binary payloads travel
  as `ArrayBuffer` with `x-varve-*` JSON headers, decoded by hand on both sides.

A renamed field or changed optionality in any of these compiles on both sides and
fails only at runtime - usually as a dropped key or a deserialization error.

## What `pnpm audit:ipc` enforces now

The guard answers one question statically: **does every literal invoke name a
real, registered Rust command?** It fails (exit 1) on:

1. a literal `invoke('name')` whose name has no `#[tauri::command]` definition;
2. a dynamic-name call site not listed in `DYNAMIC_CALL_ALLOWLIST`, or one that
   exceeds its allowlisted site budget;
3. a `KNOWN_NATIVE_GAPS` entry that Rust now defines (stale allowlist - remove
   it), because the allowlist must only shrink;
4. a literal invoke of a command that is defined but missing from
   `generate_handler!` (Tauri would reject it at runtime);
5. a duplicate `#[tauri::command]` name.

It prints a one-line summary by default (Rust count, unique literal invokes,
matched count, known gaps), the full gap names with `--verbose`, and the complete
inventory with `--report`. Plugin-namespaced commands, test files, and interface
method declarations are excluded; parser limits are documented in the script
header.

The guard does **not** enforce payload shape, argument types, return types,
serde rename/casing parity, or runtime validation. Those need the generated
bindings plan below.

## Rules for adding or changing an IPC command

### Rust side

1. Put new commands in a domain module (`home_store/tags.rs`, `printing.rs`,
   `fonts.rs`, ...) rather than growing `lib.rs`. The Home set was extracted to
   `home_store/` on 2026-10-28 (48 commands); 69 remain in `lib.rs`.
   Register the module's commands in `generate_handler!`.
2. Give new commands **typed** arguments and returns. Do not add
   `serde_json::Value` parameters, `*_json: String` blobs, or untyped
   `Vec<Value>` for new commands; use a struct with explicit
   `#[derive(Serialize, Deserialize)]` and an explicit
   `#[serde(rename_all = "camelCase")]` (or field-level renames) so TS casing
   cannot drift silently.
3. Put shared payload structs in `varve-bridge` when both Tauri and WASM need
   them; otherwise keep them in the command module. Bounds-check untrusted input
   (node counts, byte caps, dimensions) in the command, as the upscale and trace
   commands already do.
4. Run `pnpm audit:ipc` and `pnpm check:agent`. If the command intentionally
   replaces a known gap, delete its `KNOWN_NATIVE_GAPS` entry or the audit fails
   as stale.

### TypeScript side

1. Call commands from a single adapter module (`packages/platform`, the engine
   provider, or the app bridge). Do not scatter raw `invoke` through UI
   components; UI code uses the typed adapter API.
2. Use a literal command name. Dynamic transports are reviewed exceptions, not a
   pattern. Type the result at the boundary with a runtime guard (or a generated
   binding), not a bare `as`.
3. Keep the wire object shape identical to the Rust struct; when adding a field,
   add it on both sides in the same change and cover the round trip with a test.
4. Run `pnpm audit:ipc` (name parity) and `pnpm check:agent` (types).

## Known native gaps (pre-existing)

The audit found 48 remaining `home_*` commands that TypeScript invokes and Rust
has never defined, with no history of a definition. They are Home Phase 1-3
features (Drafts, Folders, Collections, Workspaces, Shared Libraries, Templates,
Assets, Branches, Permissions, Activity, Saved Searches, file-content search)
that exist only in the web/memory `Platform` adapters. The list is enumerated in
`KNOWN_NATIVE_GAPS` and printed by `pnpm audit:ipc --report`.

The first group is closed: the 8 workspace-tag commands now exist in
`home_store/tags.rs` on `varve-sync` schema v3 (`home_tags`,
`home_file_tags`), are registered, and their allowlist entries are deleted.
The remaining groups are queued in
[`agent-infrastructure-campaign-2026-10-28.md`](../plans/agent-infrastructure-campaign-2026-10-28.md#workstream-4--home-native-ipc-commands-56-originally-48-remaining).

**Behavior on desktop, measured from the call sites:** the desktop
`Platform` adapter emits the invokes unconditionally, but the UI mostly absorbs
the rejection, so the effect is degraded/empty surfaces rather than a crash:

- `packages/home/src/useHomeView.ts` wraps `listWorkspaces()` in
  `readWithFallback(..., [])`, which converts a rejection into an empty workspace
  list and discards the `ok` flag. With no workspaces the active workspace is
  null and the project list filters down - Home can look empty.
- `HomeShell.tsx` catches `listTemplates()` / `listSavedSearches()` into empty
  lists; `ProjectsView.tsx` catches `listFolders()` into an empty folder list;
  `AssetBrowser.tsx` catches `listAssets()` into an empty browser.
- `ActivityFeed.tsx` and `ShareDialog.tsx` catch and set a visible
  "Failed to load activity" / "Failed to load permissions" message.
- Mutating calls (`createFolder`, `createCollection`, ...) reject; their
  handlers surface an error state or nothing depending on the surface.

This document and the audit do not fix the gap. **Close-out:** implement the
missing commands in a Rust domain module backed by `varve-sync`, register them,
remove the entries from `KNOWN_NATIVE_GAPS` (the audit fails on stale entries, so
this is enforced), and add platform-parity coverage for the desktop adapter. Until
then, desktop Home features should not be described as working.

## Phased tauri-specta adoption

End state: one generated TypeScript bindings file, raw `invoke` confined to
adapter modules, and payload drift impossible without a compile error. The
command-name audit stays as a cheap cross-check even after generation.

| Phase | Work | Exit criteria |
|-------|------|---------------|
| 0. Name parity (this change) | audit, allowlists, seam rules, typed-adapter discipline | `pnpm audit:ipc` green; 0 new drift; known gaps enumerated |
| 1. Pilot generation | add `specta` + `tauri-specta` to `apps/desktop/src-tauri`; derive `Type` on the `varve-bridge` wire types and one small command group (acceleration or font_storage); `collect_commands!` for that group | generated bindings for the pilot group typecheck in a scratch file; no behavior change |
| 2. Generated bindings + CI drift check | commit `apps/desktop/src/ipc/bindings.gen.ts`; script regenerates it and fails CI on a diff; add it to `GENERATED_FILES` in the file-size policy and format it once | CI fails when Rust and bindings disagree |
| 3. Migrate by group | replace raw invoke + hand-written payload types with generated functions, adapter module by adapter module, starting with `packages/platform/src/tauri.ts` and ending with engine providers | each migrated group deletes its hand-mirrored TS interfaces; audit remains green |
| 4. Enforce the adapter boundary | extend the audit (or add a lint rule) so raw `invoke(` fails outside `apps/desktop/src/ipc/` and the allowlisted adapters | a component cannot bypass the typed adapter |
| 5. Retire string payloads | replace `*_json: String` arguments with typed request structs where practical; keep runtime validation for genuinely dynamic data | no new `serde_json::Value` command parameters; payload size/count bounds stay enforced |

Phase 1 can start with the 3-command `acceleration` group; the Home tags group
is now a second candidate because it is already a typed domain module with
`varve-sync`-backed payloads and no `*_json` parameters.

## Validation

```bash
pnpm audit:ipc                                        # name parity (exit 1 on drift)
node scripts/quality/audit-ipc-contract.mjs --report  # full inventory
pnpm test:ci:tools                                    # includes the audit's regression tests
```
