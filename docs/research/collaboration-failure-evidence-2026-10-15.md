# Collaboration failure-mode evidence ledger (2026-10-15)

Research record for the real-time collaboration work. Every entry states what
was **actually inspected** on 2026-10-15, what it showed, how it maps onto
Varve, and which regression test (or documented boundary) answers it.

Sources were re-fetched rather than recalled. Where a source could not be
inspected, that is recorded as a gap instead of being filled from memory.

## 1. Evidence matrix

| # | Source (fetched 2026-10-15) | Observed behaviour / failure | Relevance to Varve | Decision | Regression test |
|---|---|---|---|---|---|
| 1 | [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) (Evan Wallace, 2019-10-16) | Server-ordered last-writer-wins **per property**, no timestamps ("the server can define the order of events"). Property-level atomicity: unrelated properties never conflict. **Simultaneous edits to the same text value do not merge** ("the end result will be either AB or BC but never ABC … Figma is a design tool, not a text editor"). Deleting an object removes its properties from the server; the **deleter's client keeps the payload in its undo buffer**. Reparenting stores the parent link as a child property; the server rejects cycle-creating parent updates, while a client can still be in a temporary cycle. Child order uses fractional indexing, and "the parent link and this position must both be stored as a single property so they update atomically". | Varve's model is the same shape (ADR-0017/0200): room order, property-level captures, deleters keep their own payloads. Two deliberate differences: Varve **does** merge concurrent text at cluster granularity, and it does not yet reject cycle-creating parent changes at the host. | Keep the ordered semantic-operation model. Keep text merging (a differentiator, already implemented). Record host-side cycle rejection as a boundary to implement rather than assume. | `packages/collab/src/selectiveUndo.test.ts` (delete-restore, superseded property), `textSplice.test.ts` (concurrent text) |
| 2 | Same source as #1 | **Anti-flicker rule**: the client must "discard incoming changes from the server that conflict with unacknowledged property changes", justified because "our change is our best prediction because it's the most recent change we know about in last-to-the-server order". | Varve applied every incoming change unconditionally and never re-applied its own operation (own ops are skipped). When an unacknowledged local change to property P is outstanding and a peer's conflicting change to P arrives, the local value is replaced locally and never restored → the two participants settle on **different values for P**. | **Defect fixed**: pending local change keys now block conflicting incoming changes; catch-up replays treat already-journaled own operations as settled, and a bootstrap snapshot re-applies unacknowledged local captures on top (Figma's "reapplies any offline edits on top of this latest state"). | `packages/collab/src/syncEngine.test.ts` → "a conflicting change is discarded while my own change is unacknowledged", "an unacknowledged change survives a bootstrap snapshot", "a journaled change loses to a later one on catch-up", "disjoint properties both apply while one is pending" |
| 3 | [Making multiplayer more reliable](https://www.figma.com/blog/making-multiplayer-more-reliable/) (Darren Tsung, 2022-10-20) | Journal + checkpoint with per-file sequence numbers; recovery = latest checkpoint + all newer journal entries. Goal <1 s of loss; 95% of edits persisted within ~600 ms. Journal entries are **batched** with start/end sequence numbers, which is only safe because conflict resolution is last-writer-wins. **Split brain is prevented by a file lock** (a DynamoDB lock row; journal writes are conditional on the lock UUID; reads wait for ownership). "If update A moves a child node out from a parent node, and update B deletes the parent node, applying update B without update A would result in the child node being deleted unexpectedly" — order matters, so replay must be in order. | Varve has the checkpoint+journal+sequence design (`crates/varve-room/src/store.rs`), ack-after-commit durability, and in-order application. It documents the single-owner rule but does **not enforce** it: two processes against one data directory are a documented misconfiguration with no runtime detection. | Keep the store design (it is already the Figma shape). Treat the single-owner lock as an identified gap with a concrete design (advisory lock row + conditional writes) rather than an implicit assumption. | `crates/varve-room/src/store.rs` tests (idempotent append, atomic compaction, ahead-of-head rejection); `tests/server_integration.rs` (journal survives restart) |
| 4 | [Yjs `Transaction.js` source](https://raw.githubusercontent.com/yjs/yjs/main/src/utils/Transaction.js) (main branch, fetched 2026-10-15) | `transact(doc, f, origin, local)` runs `f` with no abort/skip path. The only unwinding is the `finally` block, which performs observer calls, GC and struct merging — the mutations `f` already made to the store are not rolled back. There is no cancellation API. | A drag, a brush stroke or an IME composition spans asynchronous input events. Holding one Yjs transaction open across pointer events and "aborting" it does not undo published changes. | Confirms the ADR-0243 rejection of a document CRDT for Varve's gesture model. Varve keeps the equivalent discipline explicitly: ephemeral previews are not transactions, and a committed gesture is one capture. | Documented in `docs/architecture/collaboration-system.md`; gesture handling is covered by the editor's own gesture tests |
| 5 | [Y.UndoManager docs](https://docs.yjs.dev/api/undo-manager) (fetched 2026-10-15) | Selective undo exists: scoped to shared types, `trackedOrigins` filters which transactions are captured, `captureTimeout` (default 500 ms) merges rapid edits, `stopCapturing()` forces a boundary. | The API **does** provide origin-scoped selective undo, so a blanket claim that Yjs undo is unusable would be unsupported. Varve's substantive reasons for its own model are elsewhere: validation before apply, host-side invariants, and compensations that are ordinary replicated captures. | **Correction recorded**: the ADR-0243 rationale overstates the Yjs undo case. Cite the non-cancellable transaction semantics and Varve's validation/ordering requirements, not an unverified "tail of correctness bugs". | n/a (documentation accuracy) |
| 6 | [tldraw sync docs](https://tldraw.dev/docs/sync) (fetched 2026-10-15; the FAQ answers are client-rendered and could not be inspected, so the FAQ is **not** cited) | "You should make sure that there's only ever one `TLSocketRoom` globally for each room … If there's more than one, users won't see each other and will overwrite others' changes." Assets are a **separate store** (`TLAssetStore`, R2 in their template), and their own template "does not provide … authentication and authorization, rate limiting and size limiting for asset uploads". Two-or-three-part backend: room socket, asset store, unfurling. Client schema/migrations must match the server's, or the client is told to refresh. Idle sessions are dropped by default (`clientTimeout` 20 s). | Three transfers: (a) single-owner-per-room is industry-normal and Varve's rule is right, but enforcement is still a gap; (b) assets belong in a separate, authenticated, size-limited channel rather than inside document operations — Varve currently carries asset bytes inside operations/snapshots; (c) an incompatible client must see an explicit failure. | Keep assets inside operations for v1 (it works, is bounded, and needs no new deployment surface) but state the cost plainly and gate the size; do not claim a separate asset channel exists. Add idle-session reaping, since a dead participant otherwise holds a slot. | `crates/varve-room/tests/server_integration.rs` (oversized inline frame refused; chunked reassembly); asset cost documented in the architecture doc's known boundaries |
| 7 | [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) (fetched 2026-10-15) | "Validate the `Origin` header on every handshake. Always use an explicit allowlist of trusted origins … Use an allowlist, not a denylist. Avoid wildcards or substring matching which are error-prone." For token clients: "prefer sending the token in the first message over WSS. Avoid tokens in URL query strings because they can leak into access logs"; "Until token validation succeeds, accept only the authentication message and do not send protected data." DoS: per-user connection limits, message size limits, rate limiting, "idle timeouts", ping/pong heartbeats, backpressure. Logging: never log message contents or tokens. | The previous Varve upgrade check accepted **any** `https://` origin (a substring/denylist-style rule) and had no rebinding defence; there was no idle timeout after authentication. Token handling already matched the guidance (first-message token, 4401 before any room data, fragment-only links). | **Fixed**: exact allow-list with loopback/tauri defaults plus `--allow-origin`; loopback `Host` requirement for DNS rebinding; idle-timeout enforcement on established sockets. Documented deviation: the inline frame cap is 2 MB (not OWASP's typical 64 KB) because design documents carry embedded raster assets — bounded again by a 256 KB chunk size for larger operations. | `crates/varve-room/src/server.rs` unit tests (allow-list, refused remote origin, rebinding host, listed host) and `tests/server_integration.rs` (oversized frame refused) |
| 8 | [Figma help: cursor chat](https://help.figma.com/hc/en-us/articles/4403130802199-Use-cursor-chat-in-Figma-Design) | **Not inspected** during this pass (help-centre page not fetched before the work was implemented; the behaviour Varve implements is derived from the product behaviour it was asked to match, not from this article). | Recorded as a research gap. Cursor-chat behaviour in Varve is specified by its own contract in the architecture doc. | Do not cite this source as evidence; if cursor-chat behaviour is revisited, fetch it first. | `tests/e2e/collab/realtime-collaboration.spec.ts` (draft visible to the peer, finalized message) |

## 2. Failure modes investigated (five distinct, across four products)

1. **Silent divergence on a concurrent same-property edit** (Figma's anti-flicker
   rule, source #1/#2) — reproduced against Varve's engine and fixed here.
2. **Non-cancellable CRDT transactions vs long gestures** (Yjs source, #4) — why
   Varve does not hold a transaction open across pointer events.
3. **Split-brain rooms from two hosts on one store** (Figma lock, tldraw
   one-room-per-document, #3/#6) — Varve documents the rule but does not enforce
   it; recorded as an open gap with a design.
4. **Asset durability and cost** (tldraw's separate asset store and its
   explicitly missing upload authorization/size limits, #6) — Varve carries asset
   bytes inside operations today, which works but re-sends bytes and caps a
   single edit at 64 MB; recorded rather than hidden.
5. **Cross-site WebSocket hijacking / DNS rebinding on a local listener**
   (OWASP, #7) — the previous permissive `https://` rule and the missing Host
   check were fixed, with tests.
6. **Ordering-dependent replay** (Figma's move-then-delete example, #3) — Varve
   replays in sequence order and rejects stale redelivery by `clientOpId`;
   covered by the sync-engine gap/resync tests.

## 3. Decisions taken from this evidence

- Keep the authoritative, ordered semantic-operation room (no document CRDT).
  Support: #1, #2 (the shape works at scale), #4 (transaction semantics), #5
  (selective undo must be a product decision, not a library default).
- Implement the pending-conflict discard rule and the catch-up semantics in
  `packages/collab/src/syncEngine.ts` (#2) — this was a real convergence defect.
- Harden the socket boundary: exact origin allow-list, loopback `Host` check,
  idle-timeout enforcement, chunked (integrity-checked) large operations (#7).
- Frame large operations rather than raising the inline ceiling (#7 + #6:
  bounded memory is the point).
- Keep assets inside operations for v1 and document the cost, rather than
  shipping a half-built asset channel (#6).

## 4. Open gaps recorded by this pass

- **Single-owner enforcement**: an advisory lock row in `rooms.db` (owner UUID +
  conditional writes, refused startup when held) would move the rule from
  documentation to enforcement. Design recorded; not implemented.
- **Separate asset channel**: content-addressed, authenticated, resumable,
  quota-limited transfer with a pending/missing-asset UI, so a document's bytes
  are not re-sent inside every snapshot.
- **Host-side tree validations**: Figma rejects cycle-creating parent changes at
  the server; Varve validates on receiving clients only, so a hostile editor can
  send a capture that forces other clients to resync.
- **Schema/format negotiation**: the wire negotiates a protocol version, not a
  document `formatVersion`; a client on an older build is detected only when a
  capture fails registry validation, which surfaces as a resync notice.
- **Cursor chat help article** (#8) not inspected; cite nothing from it.
