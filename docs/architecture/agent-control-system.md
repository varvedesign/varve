# Agent control system

Canonical contract for driving Varve from a command line, a JSON control
channel, or an MCP server. Decision record:
[ADR-0243](../adr/0243-agent-control-command-service.md). Research and failure
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
| CLI `commands`, `describe`, `exec`, `batch`, `inspect`, `doctor` over a document file | Implemented (`@varve/cli`), verified through a real subprocess against the packaged bundle |
| Self-contained CLI bundle, no runtime esbuild | Implemented (`build:bundle`); installers/sidecar packaging not done |
| Strict JSON input (duplicate keys, `__proto__`, overflow, depth, bytes) | Implemented |
| JSON-RPC 2.0 control protocol over a local socket (`varve serve`) | Implemented, verified with a raw client on Linux |
| stdio MCP server (`varve mcp`), headless and attached modes | Implemented, verified with a raw client and the v1 and v2 SDK clients |
| Streamable HTTP MCP transport | Not implemented (deliberate; see below) |
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

## Command line

`varve commands`, `describe`, `exec`, `batch`, `inspect` and `doctor` are the
headless adapter. They open a document file (or `--new <name>`) in an isolated
session, run the command through the executor, and print the receipt.

- stdout carries the result: human text, or exactly one JSON document with
  `--json`. Warnings and diagnostics go to stderr.
- Arguments come from `--args-json`, `--args-file` or `--args-stdin`, parsed
  strictly (no duplicate keys, no `__proto__`, bounded size and depth), so shell
  quoting is never in the data path. Option parsing knows each command's
  options: values may start with `-`, `--` ends options, unknown options are
  errors with a suggestion.
- **Nothing is saved unless `--in-place` or `--out` is given**, and the receipt
  says `durable.saved: false` otherwise.
- Exit codes: `0` ok, `1` request refused, `2` usage error, `3` file error or
  path not allowed, `4` unknown outcome of a retry, `5` conflict (document,
  revision or lock). Existing document commands keep their own codes.

### File safety

Every read and write goes through one gateway.

- Policy is applied to the canonical path (symlinks resolved) with a path
  relation test, not a string prefix: `VARVE_READ_ROOTS`, `VARVE_WRITE_ROOTS`
  or `--read-root` / `--write-root`. Roots are installation or invocation
  policy, never something a request declares.
- Writes are temp file, fsync, atomic rename; `--out` never replaces an
  existing file without `--overwrite` and never the source document
  (`--in-place` is the deliberate form).
- `--in-place` is compare-and-swap against the bytes that were loaded and
  takes a lock file beside the document. An existing lock is never removed.
- Symlinked targets and hard-linked documents are refused.
- A result is encoded and decoded again before it is written; a document the
  codec cannot read back is never written.
- Limit: the check-then-rename sequence is atomic only against cooperating
  writers that honor the lock. Case-insensitive volumes rely on the platform's
  canonical casing.

### Retry recovery across processes

An `--in-place` run with `--idempotency-key` records a receipt journal beside
the document (`<doc>.varve-journal.json`, bounded, 24 hours). `pending` is
written before the document is replaced and `committed` after. A retry
(`--attempt 2`) replays a committed receipt; reconciles a `pending` one against
the file's bytes (equal to the after-hash: landed, replay; equal to the
before-hash: not landed, execute; anything else: unknown outcome, exit 4).
Runs with `--out` have no journal: re-running regenerates the result file
with new ids.

## Control protocol (`varve.control/1`)

JSON-RPC 2.0, one UTF-8 JSON document per line (the same framing as MCP stdio),
over a Unix domain socket or a Windows named pipe. Transport-independent core:
`ControlConnection` in `@varve/automation`; the socket server and client live
in `@varve/cli`.

- **Handshake**: the first frame must be `session.hello` with a credential,
  client name and the protocol versions the client speaks. Before it, frames
  are limited to 4 KiB and anything else closes the connection. After
  authentication the limit is 4 MiB. A hello deadline and a failed-credential
  limit close idle and guessing connections.
- **Methods**: `session.hello`, `session.info`, `catalog.list`,
  `catalog.describe`, `command.execute`, `batch.execute`, `session.close`,
  `ping`. Unknown methods are `-32601`.
- **Application vs protocol errors**: a refused command is a *successful RPC*
  whose result is a receipt with `outcome: "rejected"`. JSON-RPC errors are for
  protocol problems only (parse, unknown method, not authenticated, frame too
  large).
- **Authored work needs a receipt**: a notification (no `id`) is never
  executed, and JSON-RPC batch arrays are refused; `batch.execute` is the
  ordered, atomic editing transaction.
- **Ordering and bounds**: requests on one connection run in order; frames are
  discarded as they stream when oversize (not buffered, then rejected); a
  result larger than the response limit is refused with `-32005`.
- **Client**: replies are matched by id; late, duplicate or foreign replies are
  ignored and counted, so a stale success cannot be reported as another
  request's result. A timeout is reported as an unknown outcome.
- **Isolation**: one client closing its connection never stops the session.

### Endpoint identity and credentials

Each instance has a directory (mode 0700 on Unix) holding the socket, a
credential file (0600) and `instance.json`. The record names the app, version,
pid, document and endpoint but never the credential, so `varve instances` can
be shown or logged. `varve instances --verify` proves an endpoint answers and
reports the identity it returns. Credential comparison is constant time.

The same-user boundary is stated plainly: another process running as the same
user can read the credential file. These controls stop other users, other
origins and accidental exposure; they are not a sandbox against same-account
malware.

## MCP server (`varve mcp`)

stdio only. The SDK is `@modelcontextprotocol/server` 2.3.1 (exact pin).

- **Modes are explicit.** `--file` or `--new` opens an isolated headless
  session and `varve_session` says it is not the running application.
  `--connect <endpoint> --token-file <path>` or `--instance <id>` attaches to a
  control endpoint. If attaching fails the server exits with an error; it never
  opens an empty document instead. `--require-mode` refuses a session of the
  wrong kind.
- **Fixed tool set**: `varve_session`, `varve_search_commands`,
  `varve_describe_command`, `varve_query`, `varve_invoke`, `varve_batch`. The
  list does not change with GUI selection or earlier searches and is returned in
  a deterministic order; `listChanged` is advertised as false.
- **Honest annotations**: tools that cannot write are read-only. `varve_query`
  runs only `effect: read` commands. `varve_invoke` and `varve_batch` can delete
  and are marked destructive. Annotations are advisory; every call is authorized
  by the executor.
- **Results**: every receipt is returned as structured content plus the
  serialized JSON in a text block, with `isError` set for `rejected` and
  `unknown` outcomes. Output schemas are the receipt schemas, and a test asserts
  every real receipt conforms.
- **Default permissions are read-only.** Edits need `--grant edit`; saving needs
  `export`. Permissions come from the process command line the person
  configured, never from a tool argument.
- **stdout** carries protocol messages only; diagnostics go to stderr; the
  process exits when stdin closes.

### Compatibility matrix

| Client | Era negotiated | Result | Evidence |
|---|---|---|---|
| Hand-written raw client, `server/discover` + `_meta` | 2026-07-28 | Works | `control-mcp.subprocess.test.ts` |
| `@modelcontextprotocol/client` 2.3.1, pinned 2026-07-28 | 2026-07-28 | Works | same |
| `@modelcontextprotocol/client` 2.3.1, default handshake | legacy `initialize` | Works | same |
| `@modelcontextprotocol/sdk` 1.32.1 (v1), `initialize` | legacy | Works | same |
| Raw client, unsupported `_meta` version | n/a | `-32022` with the supported list | same |
| `--legacy reject` with an `initialize` client | n/a | Error naming 2026-07-28 | same |
| Claude Desktop, Claude Code, Cursor, MCP Inspector | not run | **Unverified** | none |
| Streamable HTTP clients | not applicable | No HTTP transport | none |

Tasks (async jobs) and MCP Apps are not used: nothing here is long-running yet,
and clients without the extension would have no handle for it.

### Why no HTTP transport

stdio and the local socket cover the demonstrated workflows. An HTTP listener
adds Origin and Host validation, DNS-rebinding exposure, token audience binding
and session semantics that this system does not yet need. It stays out until a
client workflow requires it.

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
- `varve.document.save` exists in headless sessions through the CLI and MCP
  adapters. There is no connected (live editor) runtime yet, so nothing can
  attach to the running desktop application; `varve doctor` and `varve_session`
  say so.
