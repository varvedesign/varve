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

## 3b. Second pass — independent code review (2026-10-16)

An independent review of the collaboration commit raised findings against the
code as it stood. Each was re-derived by hand and, where it was a defect,
reproduced with a failing test before the fix. Dispositions:

| Finding | Verdict | Evidence | Action |
|---|---|---|---|
| Cursor chat broadcast one frame per **keystroke** while the host spends a single 0.5/s bucket on chat, so the frame carrying the message the author pressed Enter on was dropped silently | **Confirmed defect** | Mutation check: with drafts sharing the finalized bucket, `a_finalized_chat_message_survives_a_draft_burst` fails (`the finalized message must reach the peer after a draft burst`) | Separate draft bucket (20/s), client-side draft coalescing (4/s), final frames bypass the timer, empty final frame withdraws the draft, refusals are reported |
| The "withdraw the draft" path was unreachable: the engine refused empty chat text, so Escape/blur never cleared a peer's bubble | **Confirmed defect** | `chatFraming.test.ts` → "withdraws a draft with an empty final frame and never sends the stale draft after it" | Empty text is allowed on a FINAL frame only |
| Rust bounds counted UTF-8 **bytes** where the client counts UTF-16 code units, so a 94-character Japanese message (282 bytes) passed the client and was dropped by the host | **Confirmed defect** | Fixture now carries multi-byte text both sides must accept; `bounded()` counts characters | Character bounds in `protocol.rs`; the host can never be stricter than the client |
| A rejected frame carried no `clientOpId`, so a refused operation stayed pending forever, was re-sent every reconnect, and kept blocking conflicting changes for its keys | **Confirmed defect** | `an_out_of_bounds_operation_is_refused_by_name` | `reject_frame` attributes the refusal (`operation-rejected` with the id) whenever an operation is identifiable |
| Revocation only *notified* the session (`room-ended`), leaving a hostile client with a live authenticated socket able to read the journal, inject presence, and (as owner) replace the baseline; `snapshot-upload` did not re-check the invite | **Confirmed defect** | Mutation check: without the termination channel, `...socket must be closed` fails; `a_revoked_owner_cannot_replace_the_baseline` covers the snapshot path | Per-connection terminate channel ends the socket; presence/chat/`sync-request` re-check the invite on a TTL; snapshot uploads check immediately and report refusals |
| The `snapshot` handler's comment claimed pending operations are re-sent, but only `welcome` did it | **Confirmed defect** | code/comment contradiction; covered by the shared `resendPending()` | One resend path used by both |
| The replay-ordering divergence (an op ordered **before** my accepted change overwriting my later value) | **Not reproducible** | Two distinct interleavings were built in `syncConflict.test.ts`, and the rule that was supposed to fix it was removed again after a mutation check showed the tests stayed green with and without it: the applied-sequence watermark refuses anything at or below my own acknowledgement, so the state cannot be reached | Rule removed rather than shipped as dead code; both orderings pinned as guards, with the reasoning recorded here |
| `__stop__` sentinel could reach the UI; `abort()` could race the final frame | Plausible (race) | code inspection | Both removed: the outbound channel is drained and dropped, ending the socket normally |
| Unbounded per-connection relay queues with 64 MB operations | Plausible | code inspection | Bounded at 256 frames with an explicit "fell behind" termination |
| Mutex poisoning could turn one panic into a host that panics for every room | Plausible | code inspection | `lock()` helper recovers poisoned locks |
| `compact_with_snapshot` accepted a snapshot *behind* the stored baseline | Plausible | `compaction_refuses_a_snapshot_behind_the_stored_baseline` | Refused with a new error variant |
| `snapshot-upload` from a non-owner was a silent no-op | Plausible | `a_revoked_owner_cannot_replace_the_baseline` (non-owner branch) | Explicit `snapshot-refused` error |
| Untested reassembler rejection branches (out-of-order index, overrun, unknown upload, early end) | Confirmed gap | `each_chunked_upload_refusal_branch_is_fail_closed` | Covered, including "nothing reached the journal" |
| The chat E2E used `fill()` (one input event) and never asserted the finalized message | Confirmed gap | the test would pass with the defect above | The E2E now types key by key and asserts the full finalized text on the peer |

One further defect came out of the E2E work rather than the review, and is
recorded here because it is the same class of bug (a failure that is invisible
until someone reads the client's console):

| Finding | Verdict | Evidence | Action |
|---|---|---|---|
| The desktop Share dialog's **host-on-this-server** path hands the room a document the app produced, but a room created through the admin API with a hand-written JSON seed produces a baseline that does not match any client: every later operation fails the receiving client's validation and it resynchronizes in a loop. The E2E's own hand-written seed hit this | **Confirmed defect (setup-dependent)** | The E2E trace contains `failed validation; resynchronizing.` on the receiving page while the sending page is `Live` and shows its import; the two pages held visibly different documents | The validation notice now names the rule that refused the change, the E2E hosts through the dialog path so the baseline is app-produced, and the requirement is documented for operators creating rooms with `curl` |

A second E2E-driven find, which the review had flagged only as "the app-hosted
invite path is unexercised":

| Finding | Verdict | Evidence | Action |
|---|---|---|---|
| The room server sends no CORS headers, so the app's browser-embedded client cannot create a room on a user-run server: "Host on this server" fails with a bare `Failed to fetch` (the browser blocks the response to the admin call, and there is no way to tell that from an unreachable server) | **Confirmed defect** | The app-hosted E2E trace shows the dialog in its error state with `Failed to fetch` and the admin request never reaching the server; the same request from Node succeeds | The HTTP surface answers CORS preflights for the same allow-list as the WebSocket (loopback + Tauri + `--allow-origin`), never `*`; `the_admin_api_answers_cross_origin_calls_from_allowed_origins_only` covers the allowed, refused, and configured cases |

The root cause of "large images never replicate" was found last, by the E2E that
had been failing for environmental reasons — which is exactly why the
environmental failures were worth pursuing instead of reclassifying the test as
flaky:

| Finding | Verdict | Evidence | Action |
|---|---|---|---|
| A capture may not carry a string longer than 5,000,000 characters, while the document model itself accepts an embedded asset of up to 10 MB decoded (~13.4 M base64 characters). An inserted image above ~3.7 MB therefore produced a capture that the receiving client refused — and the sender was never told: the receiver logged `failed validation (string value exceeds size limit in after)`, resynchronized, and both participants kept their own document. The whole chunked-upload path was necessary but not sufficient | **Confirmed defect (root cause)** | The app-hosted E2E now reaches this state with a healthy baseline: the peer's console names the rule, and the image never arrives | The capture string bound is derived from the document's own asset bound (14 M) with the guard retained beyond it; the sender pre-flights every capture against the same validator and reports a refusal to the author; the receiver's notice names the rule |

Closed after the review pass (each with tests, described above and in the
architecture doc): unacknowledged operations are now persisted and replayed on
the next join; the app mints and revokes role-scoped invites from the dialog,
so the host's role enforcement is reachable through the UI; the Share dialog's
tablist implements the APG keyboard contract; and the single-owner rule is
enforced by a lock row with a staleness window rather than documented only.

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
