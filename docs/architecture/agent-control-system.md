# Agent control system

Canonical contract for driving Varve from a command line, a JSON control
channel, or an MCP server. Decision record:
[ADR-0241](../adr/0241-agent-control-command-service.md). Research and failure
ledger: [agent-control-research-2026-10-15](../research/agent-control-research-2026-10-15.md).

The goal: every supported operation has one discoverable, validated command
contract, and every automation surface executes it through the same code, so a
person and a permitted agent can inspect, edit, verify, save and recover real
work without diverging from UI semantics or bypassing safeguards.

## Status

This document describes the contract and marks what exists. A claim here is
"implemented" only when code and a test back it; everything else is labelled.

| Area | State |
|---|---|
| Strict schemas, catalog, executor, receipts, idempotency | Implemented (`@varve/automation`), unit-tested |
| Headless document authority, attributed rollback | Implemented, unit-tested |
| `document.*`, `node.*`, `history.*` commands | Implemented (document structure and typed properties) |
| CLI exec/describe/batch over a document file | Planned (next slice) |
| JSON-RPC control protocol, stdio MCP server | Planned |
| Live editor authority, desktop listener, approvals, Settings surface | Planned |
| Page, component, text-run, effect, export, capture, motion commands | Not started; tracked in the parity manifest as gaps |

## Layers

```
 CLI            JSON control channel            MCP (stdio)         editor UI
  |                     |                           |                   |
  +----------+----------+---------------------------+                   |
             v                                                          |
      Executor (validate, authorize, pin, dedupe, plan, commit, receipt)|
             |                                                          |
   DocumentAuthority  <--------- same interface ------------------------+
   (headless | live editor)
             |
   pure command functions over @varve/scene documents
```

- `@varve/automation` (architecture layer 4) is browser-safe: no Node
  built-ins, no React. Node I/O (files, sockets, stdio) lives in `@varve/cli`.
- A command is data plus one pure function: `query(doc, args)` or
  `plan(doc, args) -> next doc`. It never touches a window, a file or a
  transport. The same definition runs headless and inside the editor.
- Adapters are thin. They build a **principal** from transport evidence and
  hand a request to the executor. They contain no command logic.

## Execution pipeline

`Executor.execute` runs these checks in order and never throws for caller
input. The first failure produces a rejected receipt and changes nothing.

1. **Envelope**: strict schema; unknown keys (for example a caller-supplied
   `principal`) are errors. Canonical request size is capped in UTF-8 bytes.
2. **Command lookup**: unknown ids get a "did you mean" drawn only from
   commands the principal may see.
3. **Runtime**: headless vs connected availability.
4. **Authorization**: the principal's grants must include the command's class.
   This is the only place authorization is decided, so aliases, batch steps and
   retries cannot reach a command a principal was not granted.
5. **Target pin**: optional `documentId`, `generation`, `instanceId` must match
   the authority (`TARGET_MISMATCH`). The UI's "active document" is never an
   implicit target for a queued request.
6. **Schema version**: optional `commandVersion` must match.
7. **Arguments**: strict schema validation with JSON-pointer issues.
8. **Idempotency**: see below.
9. **Revision precondition**: optional `expectedRevision`.
10. **Plan**: the command computes a next document; invariants are verified
    (a created node must really exist under its parent).
11. **Commit**: atomic against the revision the plan was computed from.
12. **Receipt**.

Created/changed/deleted id sets are derived by diffing the documents, not from
lists a command reports, so a command bug cannot make a receipt lie.

## Receipts and outcomes

A receipt (`varve.receipt/1`) carries `outcome`, a readable `summary`, the
target (mode, instance, generation, document), the revision pair, exact
created/changed/deleted ids, an alias-to-id map, warnings, arguments filled
from defaults, a transaction id and a structured `error` when rejected.

| Outcome | Meaning |
|---|---|
| `ok` | A query completed. |
| `applied` | A mutation was committed to the authority. |
| `no-op` | Valid request, nothing changed; the summary says why. |
| `preview` | Dry run: exact sets, nothing changed. |
| `rejected` | Refused before any change; see `error`. |
| `partial` | A partial-mode batch applied some steps. |
| `pending` | Accepted; completion is a job or user interaction. |
| `unknown` | A declared retry could not be reconciled. |

`durable.saved` is separate from `applied`: a committed edit is not a saved
file. Error codes are a closed set (`INVALID_ARGUMENT`, `UNKNOWN_TARGET`,
`TARGET_MISMATCH`, `REVISION_CONFLICT`, `PERMISSION_DENIED`, `LOCKED`,
`INVARIANT_VIOLATION`, `CONFLICT`, `IDEMPOTENCY_MISMATCH`, `OUTCOME_UNKNOWN`,
...), each with a category and a `retryable` flag. Prose is never the only
signal.

## Validation rules

- No coercion: `"1"` is not `1`; `null` must be declared; `0`, `false` and
  absent are different.
- Unknown keys, unknown enum values and unknown union variants are rejected,
  with the nearest valid name as a hint.
- Numbers are finite and range-bounded; strings are bounded in UTF-8 bytes and
  must be well-formed Unicode; lists are bounded and may require uniqueness.
- An argument list naming a missing id is rejected **as a whole**, listing every
  missing id, before any change. Names are never coerced into ids; name lookup
  is a separate query (`varve.node.find`) that reports ambiguity.
- Defaults are explicit in the schema and reported back in the receipt.

## Coordinates and units

Positions are parent-local CSS pixels: the translation component of the
node's `transform`, exactly what the editor's `setNodePosition` writes. Sizes
use the editor's `resizeSceneNode` (shared from `@varve/scene`). Rotation is
degrees as stored. Colors are `#RRGGBB[AA]` sRGB. `varve.node.reparent`
recomputes the local transform so the on-canvas position is kept unless
`keepWorldPosition` is false. Receipts report the parent actually used when a
caller names none.

## Locks

A node is editable only if neither it nor any ancestor is locked. A locked node
can be edited in the same call that unlocks it; a locked ancestor must be
unlocked on its own. Enforced in the executor path for every adapter.

## Idempotency and retries

- A key is separate from any transport request id and is scoped to
  **principal and document**.
- The canonical argument hash is bound to the key: reuse with different
  arguments is `IDEMPOTENCY_MISMATCH`.
- A repeated key with the same arguments replays the stored receipt without
  executing again.
- A retry must declare itself with `attempt > 1`. If no record exists (never
  arrived, evicted, or the session restarted), the result is `unknown` /
  `OUTCOME_UNKNOWN` and nothing runs. The caller reconciles from the document
  revision and history.
- Retention is bounded (entries and age). This is not durable exactly-once
  execution and does not claim to be.

## Batches

`executeBatch` is an application operation, not JSON-RPC batching.

- **atomic** (default): all steps are evaluated against a working copy; nothing
  is committed unless every step succeeds; one commit, one undo group, one
  transaction. Steps may be queries or mutations. Commands with external effects
  are refused because rollback cannot be promised.
- **partial**: steps run in order and commit individually; `onError` is `stop`
  or `continue`; the receipt lists per-step outcomes and the overall outcome is
  `partial` when mixed.
- Steps can reference earlier results with `{ "$ref": "alias#/created/0" }`.
  A reference resolves to a string, number or boolean from a prior step's
  result by JSON pointer. It is not an expression language.

## Attribution and rollback

Every transaction records the principal, kind (`user`, `agent`, `system`),
label and transport. `varve.history.rollback` reverses one transaction by id
using a field-level three-way revert: fields the transaction did not change are
left alone; fields it changed that still hold its value are restored; id lists
(a container's children) are reverted as sets so other work added to the same
list is kept. If later work changed the same field, or edited a node the
transaction created, the request is refused with the conflicting transactions
listed and nothing is changed. It never pops the last N edits.

## Authorization and trust

- A **principal** is built by the transport from evidence it holds. It is never
  read from a request.
- Grants are classes: `read`, `edit`, `view`, `capture`, `export`, `external`.
  Settings, permissions, approvals, security and updater commands are forbidden
  domains: the catalog refuses to register them, so no automation path can
  change its own authority.
- File-path confinement is enforced at the file gateway each adapter supplies,
  not by a path-prefix string check and not by roots the client declares.
- Imported text, layer names, comments, metadata and screenshots are untrusted
  data and are never treated as instructions.
- Same-user malware with the account's own permissions is outside what a local
  token or socket permission can stop; this system reduces accidental and
  cross-origin exposure, it is not a sandbox.

## What a command is not

It is not a generic `set(anyPath)`, not `eval`, and not a shell. The generic
"invoke by id" adapter the MCP server will expose dispatches only through the
catalog, with the same validation and authorization as a named command.

## Known parity gaps (recorded, not hidden)

- The editor's opacity setter also feeds motion auto-keyframing while a
  timeline is playing. `varve.node.set` writes a static value and does not
  record keyframes.
- Nodes with stacked fills reject a single `fill` rather than silently
  changing nothing; a stacked-fill command does not exist yet.
- Headless sessions have no workspace mode. The default insertion parent is the
  active page's content root; the live editor may use its active surface and
  reports it in the receipt.
- Gesture replay, pressure strokes, text runs, components, pages, export and
  capture commands are not implemented.
