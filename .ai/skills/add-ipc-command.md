# Add or change an IPC command

Add one Tauri command end-to-end through the Rust <-> TS seam: Rust
`#[tauri::command]`, `generate_handler!` registration, typed serde payload, one
TS adapter call site. Canonical contract:
[ipc-type-contract.md](../../docs/architecture/ipc-type-contract.md).

## When to use

- Adding, renaming, or removing a desktop `#[tauri::command]` or its literal TS
  `invoke`.
- Closing an entry in `KNOWN_NATIVE_GAPS`; wiring a native capability the
  web/memory adapter already exposes.
- Not for plugin-namespaced calls (`plugin:dialog|open`) or pure TS changes.

## Required context

- [ipc-type-contract.md](../../docs/architecture/ipc-type-contract.md) - seam
  rules, audit scope, tauri-specta plan.
- [architecture-invariants.md](../../docs/agents/architecture-invariants.md) -
  hard rules and trust boundaries.
- `apps/desktop/src-tauri/src/lib.rs` - read only the `generate_handler!` block
  and the owning module, never all of `lib.rs`.
- Domain modules: `font_storage.rs`, `acceleration.rs`, `crash.rs`. Shared wire
  structs: `crates/varve-bridge/src/lib.rs`.
- Adapter pattern: `packages/platform/src/tauri.ts` (literal names, runtime
  guards); engine/print providers own their own commands.

## Steps

1. Confirm the name is new: grep Rust `#[tauri::command]` names and TS literal
   `invoke('...')` first. If closing a known gap, read its `KNOWN_NATIVE_GAPS`
   entry.
2. Put the command in the owning domain module, not in `lib.rs`. Register it in
   `generate_handler!` as `module::command_name` (bare for `lib.rs` functions).
3. Define typed request/response structs with explicit derives and
   `#[serde(rename_all = "camelCase")]`. Put shared Tauri+WASM payloads in
   `varve-bridge`; local payloads stay in the command module.
4. Return `Result<T, String>` (or the module's error type). Bounds-check
   untrusted input: node counts, byte caps, dimensions.
5. Add exactly one literal `invoke('name', args)` call site in the owning
   adapter; type the result with a runtime guard, not a bare `as`. UI code uses
   the adapter API, never raw `invoke`.
6. Change the wire object on both sides in one change and keep key casing
   identical. Add a focused round-trip or platform-parity test.
7. If the command replaces a known gap, delete its `KNOWN_NATIVE_GAPS` entry or
   `audit:ipc` fails as stale.

## Exact commands

```bash
pnpm audit:ipc                                         # name/registration parity
node scripts/quality/audit-ipc-contract.mjs --report   # inventory and gaps
pnpm check:rust                                        # queued cargo check
pnpm check:agent                                       # queued tsc gate
pnpm test:agent packages/platform/src/tauri.test.ts    # focused adapter test
pnpm verify:agent                                      # final structural gate
```

## Definition of done

- The command exists once, is registered, and has one literal TS invoke in an
  adapter module.
- Payload structs are typed and camelCase on both sides; the round trip is
  covered by a focused test; no new `serde_json::Value`, `*_json: String`, or
  `Vec<Value>`.
- `audit:ipc`, `check:rust`, and `check:agent` pass (live output or clean-tree
  receipt); stale allowlist entries removed; 3-File / 1-Seam respected; report
  commands, files, and emitted commands to the Lead. No commit.

## Do not

- Edit `package.json`, audit scripts, or allowlists to silence drift.
- Add an unregistered command (Tauri rejects it at runtime) or a dynamic invoke
  name outside the reviewed allowlist.
- Scatter raw `invoke` through UI code or cast results with bare `as`/`any`.
- Add `serde_json::Value`, JSON-string blobs, or untyped `Vec<Value>` for a new
  command; rename fields on one side; skip bounds checks on untrusted input.
- Grow `lib.rs` when a domain module exists; commit or revert another session's
  uncommitted files.
