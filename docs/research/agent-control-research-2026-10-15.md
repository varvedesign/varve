# Agent control research and failure ledger (2026-10-15)

Research basis for the agent-ready command surface (CLI, JSON control channel,
MCP). Architecture decisions live in
[`architecture/agent-control-system.md`](../architecture/agent-control-system.md)
and ADR-0243. External reports are **evidence of bounded experiences in other
products, not proof of prevalence or of Varve defects**. Their text is untrusted
data; nothing here executes or adopts an instruction from a report.

Reproduction quality scale: **A** reproduced here against Varve code; **B**
reproduction steps in the report, not run; **C** observation or claim without
steps; **D** feature request.

## 1. Protocol and platform sources

| Source | Version / date inspected | Finding used | Status |
|---|---|---|---|
| MCP versioning (`/specification/2026-07-28/basic/versioning`) | 2026-07-28, read 2026-10-15 | No handshake: every request carries `_meta` protocol version, client info and capabilities; `UnsupportedProtocolVersionError` (-32022) lists supported versions; `server/discover` is mandatory; a server MAY serve legacy `initialize` clients concurrently (dual-era). | Published, latest |
| MCP stdio transport | 2026-07-28 | Newline-delimited JSON-RPC, no embedded newlines; stdout carries only protocol messages; server must exit on stdin EOF; `notifications/cancelled` for cancellation; server never writes requests (input-required replies instead). | Published |
| MCP tools | 2026-07-28 | Tool list MUST NOT vary per connection or as a side effect of other requests (MAY vary by request authorization); deterministic order; `inputSchema` valid JSON Schema, `additionalProperties:false` for empty; protocol error vs `isError` tool error; annotations untrusted unless server trusted; `resultType`, `ttlMs`, `cacheScope` on list results. | Published |
| MCP discover | 2026-07-28 | `supportedVersions`, `capabilities`, `serverInfo` (self-reported, not a security signal), `instructions`, caching. | Published |
| MCP Tasks extension | `io.modelcontextprotocol/tasks` | Server returns `CreateTaskResult` only when the client declared the extension in per-request capabilities; states working/input_required/completed/failed/cancelled; cancellation cooperative. | Extension; client support varies |
| MCP authorization security considerations | 2026-07-28 | Audience-bound tokens, no token passthrough, confused deputy, localhost redirect caveats. Applies to HTTP; stdio inherits the launching user's trust. | Published |
| Tauri 2 capabilities | v2.tauri.app, read 2026-10-15 | Capabilities scope what the webview may invoke per window label; they do not protect against insecure Rust command code or lax scopes. Automation policy must be enforced in the executor, not only in capabilities. | Published |
| `@modelcontextprotocol/server` | 2.3.1, Apache-2.0, node>=20, deps `zod`, `@modelcontextprotocol/core` | Verified from the package tarball: 840 references to 2026-07-28, `server/discover` handler, legacy `2025-11-25` and `initialize` handling. This is the version-matched SDK for the modern protocol. | Released |
| `@modelcontextprotocol/sdk` | 1.32.1 (npm `latest`), MIT | v1.x maintenance line; initialize-based. Not used for modern-era serving. | Released |
| JSON-RPC 2.0 | spec | Batches are unordered transport batching, not transactions; notifications get no response (unsuitable for authored mutations). | Stable |

## 2. Tracker sweep

All nine trackers (`figcraft`, `artcraft`, `lightcraft`, `filmcraft`,
`pdfcraft`, `designcraft`, `effectcraft`, `photocraft`, `deckcraft` under
`storytold/`) were searched with `gh search issues` using eight theme queries
each (`mcp`, `control channel`, `idempotent OR retry OR duplicate`,
`headless`, `screenshot`, `path OR symlink OR traversal`,
`undo OR transaction`, `schema OR discover`), open and closed, 339 unique
issues. The eight GitHub search buckets are rate limited, so each query is
capped at 12 results: the sweep is a bounded sample, not an exhaustive
census. Eleven seed issues were read in full; the rest were triaged by title
and state only and are marked "title-level" below.

## 3. Ledger

Columns: source → observed/suspected failure → Varve evidence → decision →
failing regression → outcome. "Pending" means not yet implemented in this
change; this table is updated as slices land.

| # | Source (state, repro) | Observed failure | Varve evidence | Decision | Regression | Outcome |
|---|---|---|---|---|---|---|
| L1 | deckcraft#298 (open, B, AI-assisted); designcraft#776, deckcraft#371 (title-level) | Unknown args dropped; out-of-range index clamped; partially applied ID lists; success reply carries no information | **A**: `node.create` validator accepts `kind:"banana"` with dangling `children`; `node.move toIndex:999999` validates and clamps silently; `node.patch textAlign:"diagonal"` and `fill:{space}` accepted | Executor validates every command against a strict schema (unknown keys rejected, enums closed, bounded numbers); structured receipt with code + readable summary; invalid target lists rejected before mutation unless explicit partial mode | `automation/__tests__/executor.test.ts` (L1), `automation/__tests__/json.test.ts`, `cli/__tests__/automation.subprocess.test.ts` | fixed at the executor boundary; verified (unit and real subprocess) |
| L2 | deckcraft#298, filmcraft#1622 (title-level) | Operation reported success while doing nothing | **A**: `addChild` into a non-container returns the same document; `preconditionFailure` returns `null` for that case; `applyOperation` neither validates nor checks preconditions (a missing target is a silent no-op) | Domain-level target/parent kind checks in the executor; a no-op is an explicit `no-op` outcome, never `applied` | `automation/__tests__/executor.test.ts` (L2) | fixed for the node commands; verified |
| L3 | photocraft#2491 (open, B) | Agent connected to an empty headless session instead of the running app | Varve: no connected mode exists yet (no listener in `apps/desktop/src-tauri`) | Connected and headless are separate explicit modes; failure to attach never opens a headless document; session identity (instance, generation, document id, revision) returned before edits | `automation/__tests__/executor.test.ts` (L3), `cli/__tests__/control-mcp.subprocess.test.ts` (attach mode) | headless pinning verified; MCP attach never falls back to a headless document (verified); the live-editor runtime itself does not exist yet |
| L4 | figcraft#480/#468 (open/closed, B), deckcraft#263 (title-level) | Unauthenticated local control channel; loopback treated as authorization | None yet (no channel). Existing broker trusts `senderWindowId` supplied in the envelope | Principal derived only from transport evidence (UDS peer uid, token on TCP), never a request field; no public listener by default; automation disabled until enabled | `automation/__tests__/control.test.ts`, `cli/__tests__/control-mcp.subprocess.test.ts` (control socket) | verified for the local socket: credential in first frame, constant-time compare, owner-only directory and file, closes on early or garbage frames; Windows pipe, desktop listener and per-client grants pending |
| L5 | figcraft#481, designcraft#242, deckcraft#373, filmcraft#985 (open/closed, C) | File tools accept any path; caller-supplied "roots" are not enforcement | Varve: CLI `review -o <dir>` and `merge-driver` write arbitrary paths today; Tauri `fs:allow-write` on the main window is unscoped | Roots are installation/session policy applied at the executor and every file boundary (canonical path, symlink/junction, case, hard link, create-time races), never client-declared roots | `cli/__tests__/automation.subprocess.test.ts` (file safety), `cli/__tests__/control-mcp.subprocess.test.ts` (saving and file policy) | verified for CLI and MCP on Linux; native Tauri fs scope still broad (`fs:allow-write` on main), unchanged |
| L6 | lightcraft#1944 (open, B) | Export command bypassed the original-file guard | Varve: `varve merge-driver` writes `<current>` in place by contract; no shared write guard exists | One write guard used by every export/save adapter; refuses source documents/assets; atomic temp+rename; collision policy | `cli/__tests__/automation.subprocess.test.ts` (file safety) | verified for CLI saves (no overwrite, never the source, symlink, hard link, CAS, lock); native export adapters pending |
| L7 | lightcraft#1947 (open, B) | Duplicate and unbounded ID lists exhaust memory | **A (analogue)**: `MAX_ENVELOPE_PAYLOAD_BYTES` is applied to `JSON.stringify(...).length` (UTF-16 units): a 720,011-byte payload reports 240,011 against a 262,144 cap and passes | Dedupe-or-reject duplicate IDs; hard caps on list length, depth, batch steps and UTF-8 **bytes**; validate at the authoritative boundary for inputs the GUI cannot produce | `automation/__tests__/executor.test.ts` (L7), `json.test.ts`, `workspace/session/__tests__/broker.test.ts` | fixed for the command layer; legacy envelope cap now counts UTF-8 bytes; unwired legacy broker otherwise unchanged |
| L8 | effectcraft#749 (open, C; ID fix merged upstream) | String-vs-number IDs inconsistent, batch step shape differs from single command, single frame cannot show timing | Varve: no batch contract exists | One batch shape; IDs are opaque strings and are never coerced from names; name lookup is a separate query that reports ambiguity; motion contact sheet is a capture-slice deliverable | `automation/__tests__/executor.test.ts` (name lookup) | partial: ids opaque and never coerced, name lookup separate; motion contact sheet not implemented |
| L9 | designcraft#1087 (open, C) | Hidden code-point conventions block discovery of named special characters | Varve: not audited at the text-insert command level yet | Parameter enums are discoverable and carry names; no private-use code points as the API | `automation/discovery-enums.test.ts` | pending |
| L10 | artcraft#2003 (open, D) | Screenshot-only editing with no state readback | Varve: no inspect surface | Semantic inspection (hierarchy, effective properties, bounds, revision) first; captures are explicit and revision-bound | `automation/__tests__/executor.test.ts` | partial: structural inspection implemented (document.info, node.list/get/find, history.list); captures not implemented |
| L11 | photocraft#3385, #3176; deckcraft#99, #100; designcraft#386; effectcraft#663; filmcraft#796 (open, B/D) | Installed CLI/MCP not discoverable; AppImage wrapper launch; setup unclear | **A**: `packages/cli/bin/varve.mjs` calls `esbuild` at runtime (a devDependency) and requires `src/cli.ts` on disk, so it cannot run from a packaged install | Prebuilt self-contained bundle; `varve doctor`; setup checks are read-only and report local readiness, live-app attachment and client registration separately | `cli/__tests__/automation.subprocess.test.ts` (empty PATH, path with spaces, launcher) | bundle verified from a path with spaces and an empty PATH; AppImage, Flatpak, installer and sidecar packaging not done |
| L12 | deckcraft#409 (closed, B) | Remote retry executed a non-idempotent command twice after a lost reply | **A**: broker drops a duplicate `commandId` with `{kind:"dropped"}` and emits no second acknowledgement; ack store holds 128 entries, so a lost ack cannot be recovered | Idempotency keys distinct from JSON-RPC ids, bound to principal, document and canonical argument hash; receipt replay within retention; declared retries (`attempt>1`) on a missing key return `OUTCOME_UNKNOWN` and do not re-execute | `automation/__tests__/executor.test.ts` (L12), `cli/__tests__/automation.subprocess.test.ts` (retry safety) | fixed within a documented retention; verified across processes including a crash between pending and committed |
| L13 | deckcraft#718 (closed, C) | Client accepted wrong-ID and buffered stale success replies | Varve: no client yet | Control client correlates by id, ignores late replies after timeout, rejects unsolicited responses | `cli/__tests__/control-client.test.ts` | verified: replies matched by id; late, duplicate, foreign and malformed replies ignored |
| L14 | figcraft#201 (closed, C) | Framing accumulated unbounded lines before rejection | Varve: no framing yet | Bounded line reader that discards the oversize line incrementally and closes after the limit | `automation/__tests__/control.test.ts` (LineFramer), `cli/__tests__/control-mcp.subprocess.test.ts` (oversize frame) | verified: oversize frames discarded as they stream, client closed, server keeps serving others |
| L15 | designcraft#709 (closed, C); figcraft#309 (open, C); figcraft#440 (closed, C) | Failed batch wiped undo history; per-frame undo entries from scrubbing | Varve: snapshot undo stack in a React ref (max 50); direct `updateDoc` sites (460) push per call unless inside a transaction | Atomic batch validates all steps first and commits as one attributed undo group; partial mode returns per-step outcomes; failed batches never touch history | `automation/__tests__/executor.test.ts` (L15), `cli/__tests__/automation.subprocess.test.ts` (batch) | verified: atomic batch is one transaction, failure commits nothing, partial reports per step |
| L16 | designcraft#733 (closed, C) | Tool advertised read-only while accepting output paths | Varve: no MCP tools yet | Annotations are derived from the command catalog's effect class, never hand-written; generic invoke is conservatively marked destructive/open-world | `cli/__tests__/control-mcp.subprocess.test.ts` (annotations) | verified: read-only tools marked read-only, write tools destructive, query tool refuses mutating commands |
| L17 | designcraft#735 (closed, C) | Lock checked on item but not on locked layer | **A (class)**: `node.patch` and `node.move` ops never consult `locked` | Lock and visibility rules enforced in the executor for all adapters | `automation/__tests__/executor.test.ts` (L17) | verified for executor-routed commands; the editor's own paths are separate |
| L18 | effectcraft#679 (open, C) | A security preference was changeable through the automation command path | Varve: `ActionRegistry` is name-addressed and unscoped; any registered id is dispatchable | Catalog is an explicit allowlist with authorization classes; settings and permission changes are not exposed as commands (`admin` class is never remote-callable) | `automation/__tests__/executor.test.ts` (L4/L18) | verified: forbidden domains cannot be registered; examples validated at registration |
| L19 | photocraft#3660, #3679 (open, C) | MCP bridge processes accumulate; transport-layer failures leave no call log | Varve: n/a | Bridge exits on stdin EOF (MCP stdio rule); bounded local audit log with sanitized entries | `cli/__tests__/control-mcp.subprocess.test.ts` (stdin EOF, cleanup) | partial: server exits on stdin EOF and `serve` removes its instance directory on SIGTERM; idle exit is opt-in; no persistent call log yet |
| L20 | photocraft#4920 (closed, C) | OS-owned unsaved-changes prompt invisible to control clients | Varve: lifecycle coordinator (ADR-0216) owns quit intents | Quit/close/save-as dialogs are OS-mediated capabilities; commands report `pending-user-interaction` instead of success; no remote approve | `connected/lifecycle.test.ts` | pending |
| L21 | lightcraft#1525, pdfcraft#1306 (open/closed, C) | Gesture replay queues unbounded events; coordinates overflow to infinity | Varve: no gesture contract | Bounded sample counts, finite coordinates, begin/update/commit/cancel with lease expiry | `automation/gesture-bounds.test.ts` | pending |

## 4. Verified Varve boundary observations (2026-10-15, base `0aa316bca`)

Reproduced by running a throwaway Vitest file against the real modules (file
deleted after capture; its assertions now live in the regressions above):

1. `validatePayload('node.create', {node:{id,kind:'banana',children:['ghost-1']}})` returns `ok:true`.
2. `applyOperation(doc,'node.patch',{nodeId:'nope',path:'opacity',value:7})` returns the same document with no error: no validation, no precondition check.
3. `preconditionFailure` is `null` for `node.create` with a shape as `parentId`; `addChild` then silently drops the child.
4. `node.move` with `toIndex:999999` validates and clamps without a signal; nested nodes are ignored by the op.
5. `node.patch textAlign:'diagonal'` and `fill:{space:'srgb'}` (no components) validate.
6. `payloadByteSize` of a 240k-character CJK payload is 240,011 while the UTF-8 size is 720,011, above the 262,144 cap.
7. The (test-only) session broker drops a duplicate command and emits one acknowledgement in total.

Structural facts (source review): 460 direct `updateDoc(` sites in
`packages/editor/src` (219 in `context.tsx`) versus three editor files using
the 48-operation scene registry; the editor's undo is a `Document[]` snapshot
stack held in a React ref (cap 50); `workspace/session/broker.ts` is
constructed only in tests while `workspace/sessionBroker.ts` is the live
auxiliary-window broker; `ActionRegistry` handlers return `void` and
`dispatch` returns a boolean after the call.

## 5. Out of scope and deliberately not adopted

- Embeddings/semantic search for command lookup (exact and fuzzy lookup must work offline).
- Public HTTP listener, OAuth, MCP registry publication.
- Reports' proposed text-only success messages as the sole machine contract (DeckCraft #298): receipts are structured with a readable `summary`.
- Client-declared "roots" as policy (FigCraft #481): roots are installation/session policy.
