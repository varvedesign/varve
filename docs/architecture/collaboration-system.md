# Collaboration System

Canonical architecture for Varve's real-time collaboration: semantic-operation
sync, durable rooms, presence, cursor chat, spotlight, and per-participant
selective undo. Accepted direction: ADR-0200 (behavior), ADR-0019 (undo
semantics), ADR-0017 (authoritative mutation pipeline). This document states
what is IMPLEMENTED as of October 2026 and the boundaries that remain.
Operating a server (configuration, TLS, backup, limits, troubleshooting) is in
[collaboration-self-hosting.md](collaboration-self-hosting.md); the walkthrough
below is the fastest way to see the whole journey.

## Model

Authoritative semantic-operation sync (the Figma/Evan Wallace shape), not a
CRDT:

- **The room host owns the order.** Every accepted mutation gets a
  consecutive room sequence. Clients apply operations in sequence order;
  gaps trigger a catch-up replay; stale redeliveries drop by `clientOpId`.
- **The sync unit is a `document.transaction-capture` payload** — the same
  validated semantic change list the persistent history records
  (ADR-0017 §8.1, produced by the `@varve/history` differ). Property-level
  granularity: two clients changing unrelated properties never conflict;
  the same property resolves by room order (last writer in sequence wins).
- **Documents are a function of (baseline snapshot, ordered captures).**
  The host stores the baseline snapshot plus the journal; it cannot replay
  design semantics, so it never computes documents — clients apply each
  capture through the operation registry and validate it on arrival. A
  capture that fails validation triggers a visible resynchronization, never
  silent loss.
- **Bootstrap**: joining sends a `welcome` with the baseline snapshot; the
  host immediately follows with a `sync` replay of the journal after the
  snapshot. An owner client periodically uploads a fresh snapshot; the
  host compacts (replaces snapshot + truncates the journal) in ONE SQLite
  transaction — there is no partial-compaction loss window.
- **Convergent conflicts.** A change arriving while the local participant has
  an *unacknowledged* change to the same property is discarded, because the
  host acknowledges a change to its sender before relaying it and a WebSocket
  preserves per-connection order: an incoming conflicting change with no
  acknowledgement for mine means mine has not been ordered yet, so mine will
  be the room's later value. Property-level edits block only that property, so
  disjoint edits always apply; creations and deletions block by entity. A
  catch-up replay settles this definitively — a pending change that appears in
  the replay is already ordered and blocks nothing, and a bootstrap snapshot
  (which cannot contain unacknowledged work) has those captures re-applied on
  top before they are re-sent. Without the rule the local value is silently
  replaced and never restored, because own operations are not echoed back.
- **Liveness.** The host closes a socket that has sent nothing for its idle
  window (15 minutes by default) and announces the departure, so a crashed tab
  cannot hold one of a room's ten slots; clients send a 30-second `ping`
  heartbeat so a quiet observer is never reaped.
- **Durability**: an operation is ACKED only after its journal insert has
  committed (WAL, `synchronous=FULL`). Clients keep unacked operations
  pending across reconnects and re-send them once; the host deduplicates
  by `clientOpId` (at-least-once delivery without duplicates).
- **Large operations are framed, not truncated.** An operation frame above
  2 MB (`operation-begin` → ordered `operation-chunk` → `operation-end`)
  is reassembled by the host, integrity-checked against the sender's
  SHA-256 digest, and then validated exactly like an inline frame. The
  ordinary case is an embedded image asset: the document's own inline-asset
  bound is 10 MB, and the differ carries asset `dataUrl` bytes, so inserting
  a photo into a shared document produces a multi-megabyte operation.
  Bounds: 64 MB per reassembled operation, 256 KB of UTF-8 payload per
  chunk, one in-flight upload per connection. Cues above 64 MB are refused
  with a visible notice and stay in the sender's local document.

Why not a CRDT: Yjs transactions are non-cancellable (verified against the
Yjs docs and source), its UndoManager has a live tail of correctness bugs in
exactly the concurrent cases a design tool cares about, and Automerge has no
undo at all. The immutable document model plus typed operations gives
per-author operation logs, validation-before-apply, and server-side
invariant checks (the properties that made Figma choose this shape) without
inheriting those risks. Loro (first-class local undo) is the documented
fallback if a document-CRDT is ever required.

## Ownership and identity

Three identities, deliberately not interchangeable:

| Identity | Lifetime | Role |
|---|---|---|
| `deviceId` | app install | local bookkeeping only; never authorization |
| `clientId` | one join | duplicate-join detection |
| `actorId` | one join, host-assigned | authorship on operations |

Display names are cosmetic and unverified. Authorization lives entirely in
the invite token, which the host validates on every mutation — revocation is
re-checked at the host per operation, and revoking an invite closes its live
sockets immediately (revocation is an event, not a flag).

## Selective undo (release-blocking contract)

While a session is active, `undo`/`redo` are intercepted (ActionRegistry)
and become **compensating forward operations** computed against the CURRENT
document from the local participant's own recorded captures:

- A's undo never reverts B's edit. Properties B changed after A are
  skipped with an explicit reason (`superseded`), not blindly replaced.
- A's creation that B since edited survives A's undo of the creation
  (`modified-by-others`), and its membership arrays are never rewound
  behind it.
- A's delete restores the full pre-delete entity from A's own step (the
  deleter's buffer holds the payload — the Figma model).
- Text undo removes or restores EXACTLY the author's own grapheme-cluster
  sequence, located by content through an LCS position map; it can never
  delete someone else's words. Disjoint concurrent typing merges through
  the splice transform; contested spans skip with `text-overlap`.
- Compensations are themselves ordinary captures replicated to the room,
  carrying `revertsClientOpId` provenance.
- **Cursor-movement undo is unavailable while a session is active** —
  restoring a historical snapshot would erase collaborators' interleaved
  work. The interception is scoped to active sessions; single-user history
  is unchanged.

Convergence of text is property of the merge rules plus the room order and
is property-tested over randomized schedules (`textSplice.test.ts`).

## What replicates, and what does not

The session broadcasts every **committed** local transaction as a semantic
capture. Anything that produces a committed transaction is therefore
replicated; anything that deliberately does not is listed with its reason.

| Editing surface | Replicates | Mechanism / reason |
|---|---|---|
| Canvas geometry (move, resize, rotate, align, booleans) | yes | node property captures |
| Inspector values (fills, strokes, effects, typography, constraints) | yes | property captures; disjoint properties never conflict |
| Layers (rename, reorder, group, reparent, lock, visibility) | yes | container/order captures; concurrent reorders resolve by room order |
| Text editing (typed, pasted, IME, rich marks) | yes | cluster-level text changes merged on arrival |
| Pages, spreads, masters, components, variables | yes | document-scope captures |
| Inserted images and other embedded assets | yes, with a size caveat | asset bytes ride inside the capture, so a large image uses the chunked upload; see the boundaries below |
| Raster paint strokes / tiles | yes | raster layer captures; large tiles take the same chunked path |
| Import / export / Save As | import yes (it is a document edit); save and export no | saving and exporting write local files and are never replicated |
| Undo / redo | yes, as compensations | only the initiator's own eligible steps; see above |
| Prototype and motion authoring (timelines, interactions) | yes | document-scope captures |
| Selection, hover, active page, zoom/pan/rotation | presence only | view state is per-participant, broadcast lossily for awareness and spotlight |
| Cursor chat, participant list, spotlight | no | ephemeral by construction; never a document mutation, history entry, or export input |
| Cursor-movement undo (camera/selection history) | blocked while shared | restoring a historical snapshot would erase collaborators' interleaved work, so the action reports that instead of guessing |
| Local file path, unsaved-file location, dirty flag | no | per-participant local state; a shared session marks the local session dirty because room state is not the local file |
| Plugin and AI operations | yes, as ordinary edits | they commit through the same transaction pipeline and carry the same authorship rules |

Editing that cannot be supported is surfaced rather than silently lost: an
operation above the reassembled ceiling is refused with a notice and stays in the
sender's local document, an operation the host rejects produces a notice, and a
capture that fails validation triggers a visible resynchronization.

## Test

1. Host in the desktop app: **Share** → **Host** → **Host on this device**, then
   **Start sharing now**. Copy the owner invite link.
2. In a second window (or another machine on the same host, using the
   standalone server), **Share** → **Join**, paste the room server, room id, and
   invite token.
3. Edit in either window: shapes, inspector values, layer order, text. Changes
   appear in the other window without focus or camera jumps.
4. A moves a shape, B recolours it; A presses Ctrl/Cmd+Z. The position reverts,
   B's colour survives, and the reason for anything skipped is announced.
5. Type `/`, write a message, press Enter. The other participant sees the draft
   live and the finalized bubble near your cursor; Escape or clicking away
   clears it.
6. Close B's window while A keeps editing. B reopens, joins again, and catches
   up from the room (no lost or duplicated accepted edits).
7. Stop hosting (or `Ctrl+C` the standalone server) and restart it. Participants
   reconnect with their invite tokens; their unacknowledged edits are re-sent
   and deduplicated. Remember: a restarted app-hosted host is on a NEW port, so
   a stale invite link's server address must be updated.

## Presence, cursor chat, spotlight

Presence is ephemeral and lossy by construction — no acks, no journal,
TTL expiry (~30 s), client-side coalescing to 30 Hz. It never touches the
document, dirty state, or history.

- **Cursors**: page-scoped world coordinates projected through the same
  camera transform the renderer uses. The `showLiveCursors` setting gates
  rendering. There are no fabricated participants in any build path.
- **Selections**: bounded (200 ids) page-scoped outlines that never steal
  hit-testing, selection, or focus; remote deletion prunes local dangling
  ids.
- **Cursor chat**: `/` opens the composer (only when no text control holds
  focus). Drafts broadcast live under one message id and are visible while you
  type; Enter sends; Escape or leaving the field clears the draft locally and
  remotely, so a half-typed message is never sent implicitly. **Enter during an
  IME composition does not send** — that key belongs to the candidate list — and
  key events that report a composition only through `keyCode` 229 are treated
  the same way. 280-character bound, ~6 s TTL after finalization, plain text
  only (rendered as textContent, never HTML), never an operation, never
  persisted. Finalized messages from other participants are also announced
  through a polite live region, because a bubble next to someone else's cursor
  is not reachable by a screen reader; drafts are never announced.
- **Spotlight**: a participant broadcasts their viewport while spotlighting
  (Share dialog toggle). Following is a per-viewer opt-in (avatar click);
  any local camera interaction cancels it. Rotation-aware follow is a v1
  limitation: following pauses while the camera is rotated rather than
  applying an incorrect transform.

## Hosting modes

One implementation (`crates/varve-room`), two deployment shapes:

- **App-hosted (desktop)**: `collab_host_start` runs the host in-process on
  an OS-assigned loopback port with per-app storage. Reachable from other
  apps and browser tabs on the SAME machine. LAN/internet reachability is
  deliberately not wired here. `collab_host_stop` closes the listener and
  clears the host handle; rooms stay in the app's storage directory, so a
  later start reopens the same store on a NEW port and participants rejoin
  with their invite tokens. Binding goes through
  `varve_room::serve_on_current_runtime` — a Tauri async command is already
  inside the tokio runtime, and `Runtime::block_on` there panics.
- **Self-hosted**: `varve-room-server --data-dir <dir> --listen <addr>`
  (loopback by default). `--expose` is the explicit non-loopback decision
  and REQUIRES an explicit admin token. Run ONE process per data directory
  (the single-owner rule). TLS termination belongs to a reverse proxy.
- **Invite links land somewhere real**: `<server>/join#room=<id>&t=<token>`
  serves a CSP-locked landing page that reads the fragment locally (the
  token is never sent to the server), shows the room/server/token to paste
  into the app's Join tab, and states what the link grants. It is a landing
  surface, not the editor.

Admin API (room creation, invite minting, revocation, room end) requires
the admin token. **Internet reachability is not solved by this release**:
a self-hosted deployment must provide its own reachable address, TLS, and
reverse-proxy configuration; there is no relay, TURN, or tunneling service.
Exposing one behind a reverse proxy means passing `--allow-origin` for the
page origin that will open the socket (see below).

## Security boundaries

- Invite tokens: 32 CSPRNG bytes, base64url, verified constant-time against
  a stored SHA-256 hash. They travel in URL FRAGMENTS only — never in
  server logs, referrers, or the journal. The `/join` landing page reads the
  fragment in the browser and transmits nothing (`default-src 'none'`).
- Origin checking is an allow-list, not "any https page": the Tauri webview
  and loopback browser origins are always allowed, and any other Origin must
  be named with `--allow-origin` (exact match). A loopback listener also
  requires a loopback `Host` header, which is what stops DNS rebinding from
  turning a remote page into a local client; a same-host reverse proxy whose
  public name differs from the bind address adds `--allow-host`. Native
  clients send no `Origin` and are unaffected.
- Roles: `owner` (manage, snapshot uploads), `editor` (mutations), `viewer`
  (presence and chat only). A hidden edit button is not the boundary — the
  host rejects viewer mutations.
- Wire limits enforced before parsing: 2 MB inline operation frames, 64 MB
  reassembled chunked operations, 256 KB per chunk, 64 MB snapshots,
  280-char chat, 200-id selections, 20k-change captures; per-connection
  token buckets for operations and chat; 10 participants per room; finite
  rooms per server. An oversized frame that does not declare a multi-frame
  kind closes the connection instead of being buffered.
- The host cannot validate design semantics. Receiving clients validate
  every capture through the operation registry; failures resynchronize.
  A malicious editor participant can send structurally valid garbage that
  breaks their own view — visible, recoverable, attributable — but cannot
  read anything the invite does not grant or run code in another client.
- Not end-to-end encrypted. TLS is not E2EE; documents on the host are
  plaintext in the store. Do not claim zero-knowledge hosting.

## Testing

- Protocol conformance fixtures shared byte-for-byte with the Rust host
  (`packages/collab/src/__fixtures__/protocol-v1.json`).
- Convergence property tests (randomized op schedules), selective-undo
  contract tests, sync-engine tests with an in-memory host modeling the
  idempotency and ack-loss contracts.
- Chunked operation uploads: `packages/collab/src/chunkedOperation.test.ts`
  (byte-bounded slicing, digest over the reassembled frame, no lone
  surrogates, engine framing decisions) and the Rust integration tests
  `a_large_asset_operation_is_reassembled_instead_of_killing_the_session`,
  `an_oversized_inline_operation_frame_is_still_refused`, and
  `a_corrupt_chunked_upload_is_rejected_and_the_session_survives`.
- Origin/host boundary: `crates/varve-room/src/server.rs` unit tests cover
  the loopback allow-list, a refused remote origin, the `--allow-origin`
  list, and the DNS-rebinding `Host` check.
- Rust: store durability/compaction tests, live two-client integration
  (journal survives restart, viewer rejection, revocation teardown, 4401
  refusal before any room data flows).
- E2E: `tests/e2e/collab/realtime-collaboration.spec.ts` — two browser
  contexts through the real UI against a real server (no fabricated
  presence on load, live replication, cursor chat, viewer rejection),
  screenshots under `reports/collab-e2e/`.

## Known boundaries (v1)

- Text merge covers the single-divergence transform; multi-party
  same-position races converge eventually (the next full-set text op wins)
  and are documented rather than proven.
- Array rewrites (reorder) resolve by room order — concurrent reorders are
  last-writer-wins for the whole array.
- **Assets ride inside operations and snapshots.** An embedded asset is
  carried by the capture that adds it and by the baseline snapshot, so a
  late joiner gets the bytes and re-encoding does not churn revision
  identity (canonical hashing references `asset:<id>`). The cost is
  bandwidth: the same bytes are re-sent in the snapshot, and there is no
  deduplicating content-addressed asset channel, no resumable upload that
  survives a mid-transfer disconnect at byte granularity (a dropped upload
  is retried whole), and no separate asset quota. A document above the
  64 MB reassembled-operation ceiling cannot be shared as a single edit —
  it is refused with a notice and stays local.
- Linked (non-embedded) library assets are resolved locally like any other
  library reference; they are not fetched from a peer.
- Reload ends your selective-undo scope (session-local compensation
  stack); committed work stays in the room and is disclosed in the UI.
- Offline editing queues pending operations only while the app runs; the
  pending queue is not yet persisted to disk (an app crash can lose
  unacked local edits — the local file itself is untouched).
- No host migration, no offline permission re-check replay, no P2P/TURN.
- The single-owner rule (one process per data directory) is documented and
  matters — two hosts on one store can diverge — but it is **not enforced** by
  the host: there is no lock row refusing a second owner. Figma enforces the
  equivalent with a per-file lock before accepting writes.
- The host validates frame shape and roles, not design semantics: it cannot
  reject a cycle-creating reparent, so a hostile editor can force other clients
  to resynchronize (they stay correct, but they see the notice).
- The wire negotiates a protocol version, not a document `formatVersion`: an
  older client is detected when a capture fails registry validation, which
  surfaces as a resynchronization notice rather than a version negotiation.
- Owner snapshot upload cadence is owner-driven (on a size threshold);
  compaction is atomic, but a room with no owner present grows its journal
  until one returns.
