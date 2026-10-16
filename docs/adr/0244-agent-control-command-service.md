# ADR-0244: Agent control command service

- **Status:** Accepted (core, local transports, live authority, endpoint transport, editor port, settings surface and parity gate implemented; the wiring from the setting to the endpoint is verified in the launched desktop app on Linux only)
- **Date:** 2026-10-15

## Context

Varve's operations are reachable only through the graphical editor. Measured
on `0aa316bca`:

- The editor mutates through 460 direct `updateDoc(` sites (219 in
  `context.tsx`). Only three editor files use the 48-operation registry in
  `@varve/scene`, and its validators are shallow: `node.create` accepts any
  object with `id` and `kind`, `node.move` clamps silently, and
  `applyOperation` neither validates nor checks preconditions.
- `ActionRegistry` handlers return `void`; `dispatch` returns a boolean after
  the call. There is no completion receipt.
- ADR-0130's typed command route exists only as the test-constructed broker in
  `workspace/session/`; the live broker is `workspace/sessionBroker.ts`.
- The desktop app opens no listener. The CLI covers validate/diff/merge and its
  launcher needs `esbuild` and a source checkout at run time.
- The session envelope size cap counts UTF-16 units, not bytes (a 720 KB CJK
  payload measures 240 KB against a 256 KiB cap).

## Alternatives

1. **Expose `ActionRegistry` by action id.** Rejected: handlers close over
   window-local state, return nothing, and the registry is name-addressed and
   unscoped, so it would expose settings and every shortcut stub.
2. **Route every UI mutation through the scene operation registry first.**
   Rejected as a prerequisite: 460 call sites, and it would block the work on a
   multi-month refactor. It remains the direction for new UI work.
3. **Script the GUI with synthetic input.** Rejected: fragile, steals focus,
   cannot report structured results, and gives no inspection.
4. **A separate command service with strict contracts and a shared authority
   interface (chosen).**

## Decision

- Add `@varve/automation`: schema DSL, command catalog, executor, receipts,
  idempotency, headless authority, and the first command family. Browser-safe.
- A command is data plus a pure `query`/`plan`. The executor is the single
  place that validates, authorizes, pins the target, dedupes, commits and
  produces a receipt. Adapters (CLI, control channel, MCP, editor bridge) are
  thin and build a principal from transport evidence.
- `DocumentAuthority` is the one commit point. A headless authority exists now;
  the live editor will provide another behind the same interface so commands
  mean the same thing in both.
- Command semantics follow the UI function, not the registry shortcut. Where
  the editor has a pure function, it moves into `@varve/scene` and the editor
  re-exports it (`resizeSceneNode` is the first).
- Rollback is a field-level three-way revert of one attributed transaction,
  refusing on conflict rather than erasing later work.
- Settings, permissions, approvals, security and updater are forbidden command
  domains.
- Permissions are separate classes with a separate switch each, and nothing
  implies anything else: `edit` does not imply saving (`export`), and neither
  implies producing images (`capture`). A live save writes only where the person
  already chose and never opens a dialog; a capture is the export pipeline's
  pixels of one node with its revision, geometry and readiness, not a screenshot
  of the window. A capture the person granted by name is not held for approval
  each time; changes and saves are.
- Idempotency is scoped to the *client* (credential plus declared name), not the
  connection, because a retry after a lost reply arrives on a new connection.
  Attribution stays per connection. Retained receipts are bounded by encoded
  size as well as count, since a receipt can carry an image.
- Parity with the UI is tracked by a machine-readable manifest with honest
  denominators, not asserted by command count.

## Consequences

- A request the GUI can never generate (duplicate ids, huge lists, NaN, hostile
  Unicode) is rejected at the same boundary the GUI would use.
- New UI features should expose a command through the catalog; the manifest
  check fails CI when a mutation route has no mapping and no recorded reason.
- Connected mode is a session over one document, not a pointer to "the active
  document". A client that attaches to a replaced document is refused rather
  than retargeted, and an editor that cannot keep a monotonic revision is
  reported as breaking its contract instead of appearing to work.
- Parity is measured against the action ids the editor dispatches (334 today),
  not menu rows. 197 of them are recorded debt with a dated expiry; the number
  is in the report so it cannot be implied away.
- Two mutation vocabularies coexist (UI `updateDoc` and catalog commands)
  until UI code migrates; parity is verified by tests, not by shared routing.
- The endpoint lives in Rust and the protocol in the webview, so a transport
  cannot become a second implementation of validation or authorization.
- Connected mode starts only from the person's setting, through one mount that
  fails closed (endpoint first, controller enabled only after it) and restarts
  nothing for an unrelated settings change. An adapter asked to connect that finds
  no endpoint must fail, never fall back to an empty headless session. This path
  was verified in the launched app, which found four defects unit tests had not
  (a command that never returned, nodes placed on a surface the person could not
  see, disconnected clients left listed, and lost settings updates); see
  `docs/architecture/agent-control-system.md`.

- The packaged CLI is a production build (`NODE_ENV` pinned in the bundle). The
  scene package's development-only whole-document validation otherwise ran after
  every edit and made a headless session's edits cost O(document): 50 commits on
  a 3,000-node file took 11.6 to 15.4 s instead of 2.0 to 5.2 s. Measurements are
  in `docs/perf/agent-control-baseline-2026-10-16.md`.
- Rollback history is bounded by retained node-table entries as well as by
  transaction count, so a very large document keeps fewer transactions rather
  than hundreds of megabytes. The most recent one is always kept.

## Migration impact

Additive. `resizeSceneNode` moves to `@varve/scene` and is re-exported from the
editor module; behavior is unchanged and now covered by a test. No document
format change.

## Cross-platform implications

The core has no platform dependencies. Local transports use Unix domain
sockets on Linux and macOS and an authenticated loopback or named pipe on
Windows; only Linux is exercised in this repository's local validation.

## Security implications

Principal derives from transport evidence only. Authorization is enforced in
the executor and nowhere else. Commands cannot change settings or grants. The
trust boundary is stated honestly: a local token is not a sandbox against
malware running as the same user. Prompt-injection content (layer names,
comments, metadata) is data and never instruction.

## Accessibility implications

The Agent Access settings surface reuses the design system's focus order,
labels, and non-color status cues. Approval prompts are keyboard operable and
announced.

## Performance implications

Validation is linear in request size with explicit node, depth and byte caps.
Receipt id sets are derived by an O(nodes) reference diff per commit
(reference inequality first), cheap on 10k-node documents. The in-process
editor path does not serialize per pointer event.

## Rejected shortcuts

Generic `set(anyPath)`; arbitrary JavaScript or shell execution; trusting
client-declared roots or `actorId`; returning success from a handler lookup;
blind "last N undo"; treating loopback as authorization.
