# ADR-0243: Real-time collaboration — authoritative semantic-operation rooms

- **Status:** Accepted
- **Date:** 2026-10-15
- **Supersedes:** the "CRDT backend TBD" posture left open by ADR-0117/0144/0200 (their behavioral decisions D1–D5 stand; this ADR fixes the model that carries them)
- **Related:** ADR-0017, ADR-0019, ADR-0198, ADR-0200, ADR-0204, docs/architecture/collaboration-system.md

## Context

ADR-0200 defined collaboration behavior (semantic operations over stable
identities, validation-gated remote application, page-scoped awareness) but
deliberately deferred the backend model ("CRDT selection is a later, separate
ADR"). The collaboration feature now ships: wire protocol v1, the
`CollabSyncEngine`, the `varve-room` host, presence/chat/spotlight, and
per-participant selective undo. The model choice had to be made against
evidence, not the old stub's Yjs mention.

Research evidence (October 15, 2026, primary sources in the collaboration
system doc): Yjs transactions are non-cancellable and its UndoManager carries
open correctness bugs in concurrent cases (#806/#809/#811/#814); Automerge
has no undo; Loro has first-class local undo but would still import a CRDT
merge model Varve does not need; Figma's server-authoritative property-level
sync with per-user inverse-operation undo is production-proven at scale;
tldraw's sync is license-encumbered for production use and its documented
failure modes (reconnect storms, chunk assembly loss) informed our transport
hardening; Excalidraw's shared-undo era produced the worst user-trust
failures in the category; FigCraft's tracker surfaced the sequence-overflow,
idempotency, and ack-durability classes addressed below.

## Decision

D1 — **Authoritative semantic-operation rooms, no CRDT.** The host owns the
total order (per-room sequence); the sync unit is the validated
`document.transaction-capture` payload (ADR-0017 §8.1). Property-level
conflicts resolve by room order. Clients validate every capture through the
operation registry; failures resynchronize visibly.

D2 — **Per-participant undo = compensating forward operations** computed at
undo time from the local participant's own captures (ADR-0019 Model B).
Cursor-movement undo is suspended for the document while a session is
active. Compensations replicate as ordinary operations with
`revertsClientOpId` provenance. Superseded values skip with explicit
reasons; creation-removal is guarded by collaborator edits; text undo
locates the author's own cluster sequence by content (LCS position map).

D3 — **One host implementation, two deployment shapes** (`crates/varve-room`):
embedded loopback host for app-hosted sessions and the `varve-room-server`
binary for self-hosting. Single-owner per data directory. Ack only after the
journal commits; compaction is one atomic transaction (snapshot replace +
journal truncate).

D4 — **Presence is a separate lossy lane**: cursors, selections, viewports
(spotlight), and chat relay without acks or persistence, TTL-expired,
rate-limited, and never permitted to create document mutations, dirty state,
or history entries. Spotlight follow is opt-in per viewer and cancelled by
local interaction.

D5 — **Security posture**: invite tokens as SHA-256 hashes with
constant-time verification, role enforcement at the host per mutation,
revocation as teardown, frame ceilings and token buckets before parsing,
Origin checking on upgrade, and no E2EE claims (documents are plaintext at
the host; TLS terminates at the proxy).

## Alternatives rejected

- **Yjs/Yrs (CRDT)**: non-cancellable transactions force validation before
  apply anyway, so the CRDT buys nothing we use; its undo stack's open
  concurrent bugs are exactly our load-bearing path; self-hosting a Yjs
  server still requires building auth, persistence, limits, and awareness
  routing ourselves.
- **Automerge**: no undo story (maintainer-confirmed); inverse patches would
  be built by us on a heavier base.
- **Loro**: the only CRDT with production-grade local undo; documented
  fallback if a document-CRDT is ever required, but adopting it would not
  remove the need for the host, invites, durability, or presence — it would
  only replace the merge rules, at the cost of a foreign document model.
- **tldraw sync**: commercially licensed for production with key-gated
  enforcement; reference architecture only, no dependency.

## Consequences

- The operation registry becomes load-bearing for networking: every editing
  path must remain expressible as captures (the differ already covers the
  document; brush/raster deltas flow through `captureRasterTileDeltas`).
- Documents that have been shared rely on the compensation engine for undo
  while sessions are active; the persistent history panel continues to
  record local-only revisions.
- The host cannot verify design semantics; the trust model (validated on
  receive, resync on failure) is documented and tested.

## Verification

- `packages/collab` unit + property tests (protocol, textSplice convergence,
  selectiveUndo contract, syncEngine with in-memory host).
- `crates/varve-room` tests (durability, compaction atomicity, revocation,
  restart replay, conformance fixtures).
- `tests/e2e/collab/realtime-collaboration.spec.ts` (two real browser
  contexts against a real server).
