# Agent control system

Canonical contract for driving Varve from a command line, a JSON control
channel, or an MCP server. Decision record:
[ADR-0245](../adr/0245-agent-control-command-service.md). Research and failure
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
| **Live authority, host, per-client principals, pause/revoke** | **Implemented (`@varve/automation/live`), unit-tested against a real control connection** |
| **Local endpoint transport for the running application** | **Implemented: `crates/varve-automation-host` (26 tests over a real socket) plus the Tauri bridge `apps/desktop/src-tauri/src/automation_host.rs`, which `cargo check` compiles** |
| **Parity manifest and its gate** | **Implemented: 334 real action ids measured, 14 commands recorded, 197 unmapped with a dated backlog** |
| **Editor-side `LiveEditorPort` over the canonical `updateDoc` path** | Implemented in `packages/editor/src/automation/` alongside an `AutomationController` (policy, approvals, activity). The editor context exposes `readAutomationState()` so a check and an install cannot straddle a flush and a person's open transaction is visible |
| **Desktop listener reachable from the webview** | Wired: `desktopMount.ts` starts the endpoint, hands its credential to the controller, enables the controller and attaches the relay when a person turns the setting on, and tears all three down when they turn it off. Unit-tested with an injected transport, and **verified in the launched desktop app on Linux** (WebKitGTK under Xvfb, seven tests, three consecutive runs on fresh profiles; see "What the launched app found") |
| **Windows named-pipe transport** | Not implemented. `Transport::NamedPipe` exists and is refused with an explicit `Unsupported` error, so the gap is a compile-time fact rather than a runtime surprise |
| Approvals and the Agent access settings surface | Implemented: the controller supplies approvals (bound to exact args, target and revision, rechecked at commit) and `Settings > Agent Access` shows pending approvals, connected clients (disconnect), pause/resume, an activity list and the attach command. Tested against the real `EditorProvider` and controller; visual and keyboard review in a running window not done |
| **`varve.document.save` in a live window** | Implemented. Writes only where the person already chose for the document (the editor's own Save, with its disk-changed and destination checks); a never-saved, download-only or browser-handle document, or any caller-chosen path, is refused and nothing is written. Needs the `export` permission, which `edit` does not imply. Tested against the real provider with an instrumented platform; **not run against a real file system through the desktop app** |
| **`varve.capture.node`** | Implemented for a live window: one node as a PNG from the export pipeline, with size, the document rectangle it covers, the revision rendered, whether every font and image had settled, and the renderer. Needs the `capture` permission. Tested with an injected renderer in jsdom; the real pixel pipeline is covered only where stated in the verification record |
| **Rust endpoint, relay and independent clients** | Verified with a real Rust process: `varve instances --verify`, an independent MCP client (SDK v2) attached by instance id with its edit landing in the document, an oversize frame and invalid UTF-8 answered in the protocol's own words while other clients keep working, a wrong credential, two clients independent of each other, a lost reply recovered by retry on a new connection (exactly one edit), and the instance directory removed when the application goes. The relay is the production `createFrameRelay`, fed the payloads the Tauri adapter emits. **Not covered:** Tauri's event system, the webview and a window |
| **`varve config mcp`** | Implemented, read-only: prints MCP client configuration with the absolute interpreter and launcher paths. Verified by launching what it printed from a path with spaces and an empty `PATH` with an independent client |
| Page, component, text-run, effect, export-to-file, motion commands | Not started; counted in the parity manifest as the unmapped backlog |

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
10. **Plan**: the command computes a next document, and its result is validated
    against the command's declared output schema. Document invariants — parent
    existence, acyclic containment, mask and scope references — are enforced by
    the **command itself** (`INVARIANT_VIOLATION`), not centrally; see the
    [known gaps](#known-parity-gaps-recorded-not-hidden). Created/changed/deleted
    sets are the filesystem-independent exception: they are derived by diffing
    the documents, so a command cannot make a receipt lie.
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

## Grouping

`varve.node.group` and `varve.node.ungroup` are the scene's own `groupNodes` and
`ungroupNode`, the operations the editor's Group and Ungroup actions call, so the
resulting document is the one the UI makes; a parity test runs both through the
real editor and compares container, order, name and transforms. The commands add
the decisions the scene operation leaves implicit. It answers an unsupported
request by returning the document unchanged, which would reach an agent as a
no-op with no reason, so each refusal is made up front and explained: fewer than
two nodes, an unknown id, a locked node or locked ancestor, a page or master
content root, nodes under different parents (with the hint to reparent first), a
node that is not a group, and a live boolean shape, which the editor expands into
a path instead of ungrouping.

Alignment, distribution and duplication are the next arrange actions and are not
commands yet. Alignment is rotation-aware and lives in the editor's world-transform
stack, and duplication is a private function of the editor's provider; moving
either into the shared scene package is an extraction from the hub file, which is
its own change with its own parity tests, not part of this one.

## Idempotency and retries

- A key is separate from any transport request id and is scoped to
  **client and document**. A connection's principal id is minted per connection
  so a receipt names which connection wrote it; the *client* is the credential
  it presented plus the name it declared, and that survives a reconnect. The
  scope has to follow the client because the reason to retry is a lost reply, and
  the retry arrives on a new connection: with per-connection scoping a client
  that reconnected was told `OUTCOME_UNKNOWN` about work that had in fact been
  done (found by running a real client against the Rust endpoint). Clients with
  different names, or different credentials, never share a scope. Holders of the
  same credential and name do, which is acceptable because the credential is the
  trust boundary and they already share the same permissions.
- The canonical argument hash is bound to the key: reuse with different
  arguments is `IDEMPOTENCY_MISMATCH`.
- A repeated key with the same arguments replays the stored receipt without
  executing again.
- A retry must declare itself with `attempt > 1`. If no record exists (never
  arrived, evicted, or the session restarted), the result is `unknown` /
  `OUTCOME_UNKNOWN` and nothing runs. The caller reconciles from the document
  revision and history.
- Retention is bounded by entries, age and **encoded size** (a receipt that
  carries an image would otherwise make 1,024 retained entries gigabytes). A
  receipt larger than the whole budget is not retained, and a declared retry then
  reports an unknown outcome. This is not durable exactly-once execution and does
  not claim to be.

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

### Client configuration

`varve config mcp (--instance <id> | --file <doc> | --new <name>) [--client
generic|vscode|claude-code]` prints the configuration an MCP client needs, with
the absolute interpreter and launcher paths taken from the running process. It
writes nothing and edits no client: registering a server is the person's action.
An `--instance` configuration is pinned with `--require-mode connected`, so a
client pointed at the running application can never quietly become an empty
headless document. Readiness is three separate checks that this command does not
answer: `varve doctor` (the local protocol), `varve instances --verify` (the
intended window is reachable), and the client's own server list (registered).

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

## Connected sessions

Headless mode owns its document in memory. Connected mode does not: the editor
owns the document, the undo stack and the revision, and the authority is a view
of that state which installs a commit through the editor's own mutation path.
That is why the two modes share the executor, the receipts, the ledger and the
rollback rules — a command cannot mean one thing to an agent and another to a
person.

```
editor (owns document, revision, undo)
   |  LiveEditorPort: info / revision / document / status / install   (synchronous)
   v
LiveAuthority  (mode: "connected", one instance per document session)
   v
Executor  →  ControlConnection  →  AutomationHost  →  transport
```

### The editor contract

`LiveEditorPort` is deliberately small and every method is synchronous. The
editor's own mutations are synchronous, and a check-then-install pair that could
be interleaved with a keystroke or an in-flight IME composition is not a
precondition, it is a race. The port must:

- report a **monotonic revision** that increases on every committed change,
  including edits the person made;
- **refuse** an install whose `baseRevision` has moved;
- have advanced its revision before reporting success.

An editor that installs a document without advancing its revision is reported as
`INVARIANT_VIOLATION`, not as success: the client did nothing wrong and must not
be told to re-attach, and a later request must not be misled into believing it
is looking at fresh state. That distinction is why `CommitResult`'s unavailable
variant carries an explicit code instead of leaving the executor to guess.

### One authority per document session

The editor constructs an authority when a document session opens and disposes it
when that session ends, so `generation` never changes underneath a client —
`generation` answers "is the session I planned against the one I am still talking
to?". If the document is closed, replaced, or Save-As'd away, later requests are
refused and the session is never retargeted. There is no silent fallback to an
empty document and no picking of a different instance.

## Automation host and policy

`AutomationHost` is what a transport accepts connections into. It owns the parts
that must not depend on which transport it was:

- **One principal per connection.** A credential identifies the client, not the
  connection, so two agents on one document get distinct principal ids and a
  receipt always names its writer. Revocation and attribution are per
  connection.
- **A bounded connection count**, because a local listener is still a resource a
  broken client can exhaust.
- **Pause, resume and revoke.** "Stop automation" refuses new commits and jobs
  while reads and agent-scoped view changes keep working, so a blocked client
  can still see *why* it is blocked. Pausing never undoes committed work.
  Revoking one client closes only that client's connections.

Policy is enforced through `ExecutionPolicy` at the executor's single gate. It
can only refuse — it cannot grant — and it is never reachable from a request.

## The transport split

The endpoint cannot live in the webview: a browser page cannot open a listener.
So the socket is in Rust and **the protocol is in the webview**, and the two meet
at one narrow seam.

```
crates/varve-automation-host     endpoint, framing, limits, instance record
        ^  FrameRelay trait
        |  "here is a line; tell me what to write back"
apps/desktop/src-tauri/automation_host.rs
        ^  emit + invoke
        |  one event per frame, one reply per frame
packages/editor/src/automation/desktopTransport.ts
        ^
        |  AutomationHost  →  Executor  →  LiveAuthority  →  LiveEditorPort
packages/editor/src/automation/controller.ts
```

What the transport is allowed to decide is deliberately small: byte limits, a
handshake deadline, a connection cap, and who is connected. It does not parse
JSON-RPC, does not read `session.hello`, does not compare credentials, and does
not decide success. When it must refuse something — an over-limit frame,
invalid UTF-8, a connection that never handshook — it *asks the application for
the frame to write* rather than inventing an error format, because `-32003` and
the sentence that goes with it belong to the protocol. With no answer it closes.

That is why `varve.control/1` has one implementation rather than two, and why a
transport change cannot loosen validation or authorization.

The credential is minted by the transport because the transport owns the
instance directory, and it is handed to the webview **once**, because the webview
is what compares it. `automation_status` never returns it.

## Turning it on: the setting, the mount and the surface

Connected mode is off until a person turns it on in `Settings > Agent Access`.
The stored setting (`settings.automation`) has five values, each naming exactly
one thing: `enabled`; `grants` (`read` or `edit`); `save` (the `export` class,
only while changes are allowed, and only ever to the file the person already
chose); `capture` (the `capture` class, an image of one node); and
`requireApproval` (on unless explicitly `false`; a missing or hand-edited value
cannot remove the check). Nothing is implied by anything else: editing does not
imply saving, and saving does not imply images. A granted capture is not held
for approval each time, because it changes nothing and the person granted it by
name; changes and saves are held while approval is on. No command can read or
change any of this, so an attached client cannot widen its own authority.

`desktopMount.ts` turns that setting into a running session, in a fixed order:

1. Load the controller. Until now it does not exist: the automation system is a
   dynamic import, and publishing the editor into the seam stores one reference.
2. Start (or re-scope) the endpoint and learn its credential.
3. Hand the credential to the controller, then enable the controller.
4. Attach the relay.

Any failure at any step leaves the controller disabled with no credential, stops
the endpoint, and reports `error` with the reason. The mount also guarantees:

- **Latest setting wins, in order.** Applications are serialized and a
  superseded one is dropped. Turning it off while the endpoint is mid-start ends
  with the endpoint stopped and the controller never enabled.
- **Applying the setting it already runs with is a no-op.** A restart mints a new
  credential and disconnects clients, so an unrelated edit elsewhere in Settings
  must never cause one. The settings provider keys its effect on the three
  values, not on the section object the store rebuilds.
- **The endpoint follows the document.** It is re-scoped when the editor shows a
  different document, and started when it was persisted on at a document-less
  start (Home). A client is never carried across to a document it did not attach
  to.
- **A webview reload is recoverable.** The Rust endpoint outlives the page and
  reports "running" without a credential the new page cannot know. The mount
  restarts it, which is the only way to learn a credential.
- **A browser says so.** The state is `Unavailable here` with the reason; nothing
  pretends to listen.

The surface shows what the controller knows and nothing it should not: state in
words (not colour alone), the attach command (`varve mcp --instance <id>`;
the credential stays in an owner-only file and is never displayed), pending
approvals with the command, target document, revision and a bounded view of the
arguments, connected clients with Disconnect and block (the credential is shared by every client of a window, so the block applies to all of them until Allow access again), Pause/Allow changes (both withdraw anything still waiting for approval), and a
bounded activity list (200 entries, no arguments). Argument text is shown as
plain text, never interpreted.

## What the launched app found

Running the feature in the real desktop application, rather than reasoning about
it, found five defects that no unit, integration or browser test had caught. All
five are fixed, each with a test that fails against the old behaviour:

1. **Enabling never completed.** The `automation_apply_policy` command called
   `block_on` from inside an `async` command already running on the runtime. That
   panics the task, the panic is not reported to the webview, and the invoke
   promise never settled: the surface sat on "Starting" with no endpoint. It
   compiled and passed `cargo check` and every crate test.
2. **An agent's node was invisible.** It was created, approved, listed and
   capturable, but sat on a print page while the Design workspace shows a design
   canvas, so it never appeared in the Layers panel. The live editor now supplies
   its own default surface.
3. **A client that left stayed listed.** Rust owns the sockets and nothing told the
   webview when one closed, so every short-lived CLI call left a dead session
   until the connection cap turned real clients away. The transport now reports
   every closed connection.
4. **Settings changes could be lost.** `updateSection` built its next state from a
   stale closure, so two changes before a render lost the first. This affected
   every Settings section, not only this one.
5. **"Disconnect and block" left the socket open.** The window dropped the agent
   from its list, but the application owns the protocol and Rust owns the sockets,
   and Rust only learned a session was over when the peer next sent something. An
   idle blocked agent kept its socket, and its place under the connection cap,
   while the window said it was gone. The host can now be asked to close a live
   connection (`close_connection`, `automation_close_connection`), cancelling even a
   connection that is waiting on the application for a held request, and the relay
   asks for it whenever the host, not the transport, ended the session.

Two of the five failures seen while writing the native test were the test's own
state (a profile that survives between runs, and a recovery prompt left by
abrupt shutdowns); the run now uses a fresh profile each time.

## Parity manifest

`packages/automation/parity/agent-parity.json` links every action the editor can
dispatch (`createActionHandlers` really returns 334 ids) to either a semantic
command or a recorded reason it is not one. The gate in
`packages/editor/src/automation/__tests__/agentParity.test.ts` fails on a new
unclassified route, a classified action that no longer exists, a reviewed action
mapped to a command the catalog does not register, a registered command that is
unrecorded, an "implemented" command with no existing test file or no
preconditions, and an expired backlog.

Two things the manifest states rather than implies:

- `commands[].uiSurfaces` is informational. Only the `reviewed` map is enforced.
  Inspector edits reach the document by a direct call and have no dispatcher
  action id, so they can never appear in `reviewed`.
- The unmapped backlog carries one expiry. Debt that is not dated becomes
  permanent by default.

Readable form: [`docs/audits/agent-parity-coverage-2026-10-15.md`](../audits/agent-parity-coverage-2026-10-15.md).
`pnpm audit:agent-parity` fails when that report is stale.

## What a command is not

It is not a generic `set(anyPath)`, not `eval`, and not a shell. The generic
"invoke by id" adapter the MCP server will expose dispatches only through the
catalog, with the same validation and authorization as a named command.

## Known parity gaps (recorded, not hidden)

- **No central plan-invariant verification.** Each command raises
  `INVARIANT_VIOLATION` for the invariants it knows about, and a new command that
  omits them is not caught anywhere: `executor.ts` validates arguments, the
  output schema and the resulting id sets, but never the document's shape. This
  is deliberate debt, stated rather than implied, because a from-scratch plan
  verifier is its own slice.
- **A rollback checks child-list references only.** `varve.history.rollback`
  refuses when a later edit makes a three-way revert unsafe, but its
  dangling-reference check inspects containment lists; a node bound as a clip
  mask or an adjustment scope *after* the transaction could be removed by a
  rollback that then reports success.

- **The launched-app run covers Linux only.** The desktop application was
  driven through its embedded WebDriver (`tests/wdio/agent-access.e2e.ts`, WebKitGTK
  under Xvfb): the setting starts a real endpoint, a separate client process attaches
  to the open document, a held change is approved with a real click, a capture
  returns native pixels, pausing withdraws a change that was waiting for approval,
  "Disconnect and block" closes the blocked client's socket and refuses the shared
  key to every client until "Allow access again", and switching it off removes the
  endpoint. macOS (WKWebView)
  and Windows (WebView2) have not been run; Windows has no transport at all.
- **Windows has no transport.** `Transport::for_this_platform()` reports the gap
  and the endpoint refuses to start there with a clear error.
- The editor also cannot be mutated by automation through any other path: the
  command catalog is not reachable from the UI, and the UI is not reachable from
  the catalog.
- **195 of the 334 dispatchable editor actions have no semantic command.** They
  are counted, bucketed and dated in the parity manifest rather than described
  as covered. The largest families are typography, layout/alignment, vector
  geometry, masking, masters/pages, area selection, image/raster, motion,
  logo/variants and presentation.
- The editor's opacity setter also feeds motion auto-keyframing while a
  timeline is playing. `varve.node.set` writes a static value and does not
  record keyframes.
- Nodes with stacked fills reject a single `fill` rather than silently
  changing nothing; a stacked-fill command does not exist yet.
- Headless sessions have no workspace mode, so their default insertion parent is
  the first publishing page's content root. A live editor answers with the surface
  its own tools insert into (`defaultParentId`), which is what keeps an agent's
  nodes visible in the Layers panel; `document.info` reports the same parent a
  command would use. An explicit `parentId` always wins.
- Gesture replay, pressure strokes, text runs, components, pages and
  export-to-file commands are not implemented. Capture covers one node as a PNG;
  there is no region, page, contact-sheet or full-UI capture, and no capture of a
  native GPU surface. A drag's intermediate samples cannot be
  reproduced by a committed-result command, and no bounded gesture-replay
  contract exists yet.
- An agent commit is **refused, not joined**, while a person has a transaction
  open (a drag, a text edit): the port answers with a retryable `CONFLICT`
  instead of folding the agent's change into the person's undo step. A client
  that retries after the person finishes succeeds. A stale plan is refused with
  `REVISION_CONFLICT`; neither is a silent overwrite.
- Clicking, selection, camera and tool changes are not commands. A request
  cannot take over the user's screen, and no agent-scoped view command exists,
  so `view`-class authorization is declared but unused.
- `varve.document.save` exists in headless sessions through `varve serve` and
  `varve mcp`, and in a live window; it does not exist under `varve exec` /
  `varve batch`, which attach no external handler (those write with `--in-place`
  or `--out`). A live save reports the revision written and the destination, not
  a byte size or hash, because the editor's persistence layer owns the encoding.
- A capture's `complete` flag reflects the export pipeline's own barrier (fonts
  settled, image resources settled or reported). It is not a claim that the
  document is finished, and a document that is edited while the image renders is
  reported through `currentRevision` rather than waited for.
