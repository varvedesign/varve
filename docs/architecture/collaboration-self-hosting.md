# Running a Varve room server

Operational guide for the self-hosted collaboration service
(`crates/varve-room` → the `varve-room-server` binary). The architecture and
trust model live in
[collaboration-system.md](collaboration-system.md); this document is the
run-it/back-it-up/secure-it guide.

Everything below describes what the code in this repository does. Where a
guarantee is partial, it says so.

## What the service is, and what it is not

- It is the authoritative **room host**: it authenticates invite tokens,
  assigns each accepted mutation a room sequence, journals it durably, and
  relays presence. It never interprets document semantics — it cannot replay
  design operations, so it stores them and lets clients validate them.
- It is **not** an identity provider. There are no accounts. Authorization is
  the invite token, and a token is a bearer credential.
- It is **not** end-to-end encrypted. Documents are plaintext in the store.
  TLS protects the wire, not the disk, and not the administrator's view.
- It is **not** a relay/turn/tunnel service. A loopback or private-address
  deployment is not reachable from the internet; see
  [Reachability](#reachability).

## Quick start (loopback, single machine)

```bash
# Build once
cargo build -p varve-room --bin varve-room-server

# Run: loopback only, data in ./varve-rooms, admin token generated and printed
./target/debug/varve-room-server --data-dir ./varve-rooms --listen 127.0.0.1:8790
```

The admin token is printed to stderr once. With no `--admin-token`, a restart
generates a new one, which invalidates earlier admin sessions — the safe
default for loopback operation.

Loopback means: other apps and browser tabs **on this machine** can join.
Nothing leaves the host.

## Configuration

| Flag | Default | Meaning |
|---|---|---|
| `--data-dir <path>` | `./varve-rooms` | Storage directory. One process per directory (see [Single-owner rule](#single-owner-rule)). |
| `--listen <addr:port>` | `127.0.0.1:8790` | Bind address. |
| `--expose` | off | Permit a non-loopback bind. Required for any non-loopback address; startup also refuses without an explicit `--admin-token`. |
| `--admin-token <t>` | generated | Admin API credential (room creation, invites, revocation, room end). |
| `--allow-origin <o>` | none | Browser origin additionally allowed to open a socket (repeatable). |
| `--allow-host <h>` | none | `Host` header additionally accepted on the upgrade (repeatable). |
| `--help` | — | Print usage. |

### Origin and Host policy (read this before exposing the server)

A WebSocket is not protected by the same-origin policy, so the upgrade
performs its own checks:

- **Origin**: the Tauri webview and loopback browser origins
  (`http://localhost*`, `http://127.0.0.1*`, `http://[::1]*`, `*.localhost`)
  are always accepted. Any other browser origin must be listed with
  `--allow-origin`. Native clients send no `Origin` at all and are unaffected.
  "Any `https://` page" is deliberately **not** accepted.
- **Host**: on a loopback listener the `Host` header must itself resolve to
  loopback. This is the DNS-rebinding defence: a page that points its own DNS
  at `127.0.0.1` still sends its own hostname in `Host`, and is refused. Add
  `--allow-host` when a reverse proxy on the same machine forwards a public
  name to the loopback listener.

A refused upgrade is an HTTP 403 with no room data sent.

## Health and readiness

| Endpoint | Meaning |
|---|---|
| `GET /health` | Process is up. Returns `{"ok":true}`. |
| `GET /ready` | The room store can be opened. Returns `200 {"ready":true}` or `503 {"ready":false}`. |

Use `/health` for liveness and `/ready` for readiness. Both are unauthenticated
by design and expose no room data.

## Data directory, volumes, and durability

The directory holds one SQLite database, `rooms.db`, plus its WAL sidecars
(`rooms.db-wal`, `rooms.db-shm`) while running. Tables: `rooms`,
`room_sequences`, `operations` (the journal), `snapshots` (the baseline), and
`invites` (token **hashes** — never token plaintext).

Durability contract:

- An operation is acknowledged to its sender **only after** its journal row has
  committed. The store runs in WAL mode with `synchronous=FULL`.
- Compaction (baseline snapshot + journal truncation) happens in **one**
  transaction: there is no window where an acknowledged edit could vanish on
  restart.
- Sequence assignment uses checked arithmetic and a `(room_id, client_op_id)`
  unique index, so a retried operation after a dropped ack is deduplicated
  rather than appended twice.
- A store that cannot be opened fails startup loudly. Damage is an error, never
  a silent truncate.
- Rooms survive a restart: a room is reconstructed from its baseline snapshot
  plus the journal, and clients reconnect with their invite tokens.

**Container volume**: mount `--data-dir` on a persistent volume. A container
with an ephemeral filesystem loses every room on restart, and this is silent —
the server will happily create a fresh database.

### Backup

The store is SQLite; use the SQLite backup facility rather than copying a
live file, and never back up only `rooms.db` while ignoring an in-flight WAL:

```bash
# Logical, consistent, safe against a live writer:
sqlite3 /var/lib/varve-rooms/rooms.db ".backup '/backup/rooms-$(date +%F-%H%M).db'"

# Or, with the server stopped:
systemctl stop varve-room-server
cp /var/lib/varve-rooms/rooms.db* /backup/
systemctl start varve-room-server
```

A backup contains documents in plaintext. Encrypt the backup wherever you keep
it, and treat it with the same care as the live store.

### Restore

```bash
systemctl stop varve-room-server
rm -f /var/lib/varve-rooms/rooms.db-wal /var/lib/varve-rooms/rooms.db-shm
cp /backup/rooms-2026-10-15-1200.db /var/lib/varve-rooms/rooms.db
systemctl start varve-room-server
curl -fsS http://127.0.0.1:8790/ready
```

Restoring an older backup discards operations committed after it. Participants
who reconnect are resynchronized from the restored baseline and journal, so
they converge to the restored state — but their intervening edits are gone.
Tell participants before you restore.

### Compaction and journal growth

A room keeps its baseline snapshot plus every operation after it. The baseline
is refreshed when an **owner** client uploads a snapshot (the desktop app does
this on a size threshold), which also truncates the journal.
Consequence to plan for: **a room with no owner present grows its journal
indefinitely.** Have the owner reopen the session periodically, or end and
recreate long-lived rooms.

## Admin API

All admin routes require the `x-varve-admin-token` header and are refused with
401 otherwise. The API is reachable wherever the server listens — keep it on
loopback and let the reverse proxy decide what to expose.

```bash
ADMIN='x-varve-admin-token: <your admin token>'
BASE=http://127.0.0.1:8790

# 1) Create a room seeded with the current document.
#    `documentJson` is the canonical serialized document (the desktop app's
#    Share dialog does this for you).
curl -fsS -X POST "$BASE/admin/rooms" -H "$ADMIN" -H 'content-type: application/json' \
  -d '{"docId":"poster","documentJson":"{\"id\":\"poster\"}"}'
# → {"roomId":"room-…","ownerInviteToken":"…"}

# 2) Mint an editor or viewer invite (expires in hours, default 168).
curl -fsS -X POST "$BASE/admin/rooms/<roomId>/invites" -H "$ADMIN" \
  -H 'content-type: application/json' -d '{"role":"viewer","expiresInHours":24}'

# 3) Revoke an invite by its SHA-256 hash (hex of the token string).
#    Revocation is an event: matching live sockets are closed immediately.
HASH=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)
curl -fsS -X DELETE "$BASE/admin/invites/$HASH" -H "$ADMIN"

# 4) End a room: deletes its stored data and disconnects everyone.
curl -fsS -X DELETE "$BASE/admin/rooms/<roomId>" -H "$ADMIN"
```

Roles are enforced at the host on **every** mutation, not in the UI: a viewer
invite cannot write. A revoked invite is re-checked per operation, so an
already-connected client stops being able to write the moment revocation lands.

Revocation cannot recall data a participant already received. If the document
must not be seen, revoke, end the room, and treat the content as disclosed.

To make a link a client can open, hand out
`<public-base>/join#room=<roomId>&t=<inviteToken>`. The landing page reads the
fragment in the browser and transmits nothing; the token never reaches the
server's logs.

## Reachability

Answer this before promising anyone an invite link:

| Deployment | Who can join |
|---|---|
| Default loopback `--listen 127.0.0.1:8790` | Other apps/tabs **on that machine** only. |
| `--listen 0.0.0.0:8790` on a LAN host, `--expose` | Machines on the same network that can route to that address. |
| Behind a reverse proxy on a public host, TLS | Whoever can reach the proxy and holds a token. |

Deliberate non-actions: the server never opens firewall ports, configures
UPnP, creates tunnels, or contacts a cloud service. There is no hosted relay,
no TURN server, and no automatic NAT traversal.

If you need collaborators outside your network, the supported route is a
reachable host of your own (a VPS, a home server with port forwarding) running
this server behind TLS. A user-controlled private network (WireGuard, Tailscale,
similar) is a legitimate way to give it a reachable address without exposing it
to the internet; that is your infrastructure, not something Varve configures.

Bandwidth and privacy implications: every operation and every presence frame
travels through the host, and a document's embedded assets travel inside
operations and snapshots. The host administrator can read documents in the
store in plaintext.

## TLS and a reverse proxy

The server speaks plain HTTP/WebSocket by design; terminate TLS in front of it.
The proxy must forward the WebSocket upgrade for `/room/*`.

Caddy (automatic certificates):

```caddyfile
rooms.example.com {
    reverse_proxy 127.0.0.1:8790
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name rooms.example.com;

    ssl_certificate     /etc/letsencrypt/live/rooms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rooms.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;   # long-lived sockets; do not idle-close them
        client_max_body_size 64m;   # must cover the largest reassembled operation
    }
}
```

Both forward `Host`. If your proxy forwards a public name to a loopback
listener, start the server with `--allow-host rooms.example.com`. If a web
client is served from another origin, add `--allow-origin https://app.example.com`.
Opening a browser page that connects to the room also requires that origin to
be allowed; the desktop app does not (it sends no `Origin`).

What TLS does and does not give you: it encrypts the wire between client and
proxy, and between proxy and server if you configure that. It does **not**
protect the document from the server, the proxy, or the store. Do not describe
this deployment as end-to-end encrypted.

## Limits, quotas, and overload behavior

| Limit | Value | Behavior past it |
|---|---|---|
| Participants per room | 10 | New join is refused with `room-full` and close code 4429; existing participants are unaffected. |
| Rooms per server | 256 (`HostConfig.max_rooms`) | Room creation fails; the admin API returns an error. |
| Operation frames | 2 MB inline | Larger operations must use the chunked path (below). An oversized frame that does not declare a multi-frame kind closes the connection. |
| Reassembled chunked operation | 64 MB | Upload is rejected with a visible reason; nothing is journaled. |
| Chunk payload | 256 KB UTF-8 | Frame is rejected as out of bounds. |
| Chunks per upload | 4096 | `operation-begin` is rejected. |
| Concurrent uploads per connection | 1 | Second `operation-begin` is refused with "Another upload is already in progress."; the first is untouched. |
| Snapshot upload | 64 MB | Out-of-bounds frames are refused. Owner-only. |
| Chat messages | 280 characters | Longer frames are refused; the client also enforces `maxlength`. |
| Selection broadcast | 200 node ids | Larger frames are refused. |
| Finalized chat rate | 0.5/s, burst 5 | A refused message is reported to its author (`chat-rate-limited`); no message a person pressed Enter on is dropped silently. |
| Chat DRAFTS | 20/s, burst 40 | Separate bucket, so live-typing drafts can never consume the finalized-message budget. Drafts stay lossy by design. |
| Operation rate | 30/s, burst 60 | Excess operations are rejected with a visible reason; the local edit is kept as pending work. |
| Idle socket | 15 minutes without a frame | The socket is closed and the departure announced, releasing the participant slot. Clients send a 30-second `ping` heartbeat, so a participant who is only watching is not reaped. |
| Outbound queue | 256 frames per connection | A peer that stops reading is ended with a reason and can reconnect; the host never buffers operations without limit for one stalled client. |
| Text bounds | Characters, not bytes (chat 280, label 120, names 60) | Both sides count characters, so a multi-byte message is never refused after the client accepted it. |

Overload is per connection and per room. The host never blocks a whole room on
one slow participant: each participant has its own outbound queue, and a
disconnected sink is dropped.

Large operations — the ordinary case is an inserted image asset, since the
document's own inline-asset bound is 10 MB — are framed as
`operation-begin` → ordered `operation-chunk` → `operation-end`. The host
reassembles the frame, verifies the sender's SHA-256 digest over the
reassembled bytes, and then validates it exactly like an inline operation.
An upload interrupted by a disconnect is retried whole on reconnect (operations
are deduplicated by `clientOpId`).

## Graceful shutdown

`SIGINT`/`SIGTERM` stop accepting work and shut down the HTTP server. Because
every acknowledged operation is already committed, a restart loses nothing that
was acknowledged; clients go to `Reconnecting…` and re-establish with backoff.
Killing the process mid-write is safe for the same reason (WAL + one-transaction
compaction), but the room's undelivered tail is simply not there — which is why
the client keeps unacknowledged operations pending and re-sends them.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| Socket closes immediately, close code 4401 | Invalid, expired, or revoked invite; or the token belongs to a different room. | Mint a fresh invite. The host sends no room data before this check. |
| Close code 4429 with "room-full" | The room is at the participant limit. | Wait for someone to leave, or raise `MAX_PARTICIPANTS` in `crates/varve-room/src/protocol.rs` (a protocol constant shared with the client). |
| HTTP 403 on the upgrade | Origin not allowed, or a non-loopback `Host` on a loopback listener. | Add `--allow-origin` / `--allow-host`, or fix the proxy's `Host` header. |
| `ready` returns 503 | The store cannot be opened. | Check permissions and free disk space; the process logs the store error. |
| Clients loop between "Reconnecting…" and dropping | The operations are oversized for the inline frame and something is bypassing the chunked path, or the server was restarted on a different port behind a stale proxy. | Check the server log and the participant's notices; a reassembled operation over 64 MB is refused with a visible reason. |
| `operation-upload-rejected: Upload digest did not match.` | The reassembled frame did not match the declared digest — truncation, a buggy client, or a hostile frame. | Nothing is journaled; the client keeps the edit pending and retries. Investigate the client build. |
| Journal grows without bound | No owner has been present to upload a snapshot. | Have the owner reopen the session, or end and recreate the room. |
| A participant silently disappears after ~15 minutes of watching | Their client stopped sending the liveness heartbeat (a crashed or frozen tab, or a client that never sent one — the desktop, browser and test clients all do). | Nothing to fix server-side: the socket was dead. The slot is freed deliberately so a crashed tab cannot hold a place in a 10-participant room. |
| Two servers on one data directory | The single-owner rule was violated. | Stop one immediately and restore from backup; divergent rooms are possible. |

### Single-owner rule

Run **one** process per data directory. Two processes against one SQLite file
are not coordinated by the server, and divergent room state or corruption is
possible. This mirrors the rule tldraw documents for its socket room. Scale by
running one process per data directory (for example, one per project), not by
starting a second copy of the same directory.

## Verifying a deployment

```bash
# 1) Liveness and readiness
curl -fsS http://127.0.0.1:8790/health
curl -fsS http://127.0.0.1:8790/ready

# 2) Create a room, mint a viewer invite, confirm a viewer cannot write.
#    (See the Admin API section; a viewer mutation is rejected with
#    "You have view-only access to this session.")

# 3) Restart durability: note the last accepted sequence, restart the server
#    against the same data directory, join again with the same invite, and
#    confirm the journal replay reconstructs the document. The integration
#    test that covers this is
#    `cargo test -p varve-room --test server_integration`.

# 4) Confirm a revoked invite is refused before any room data flows (4401).
```

## Supported limits summary

One process per data directory; up to 256 rooms and 10 participants per room by
default; documents up to 64 MB per reassembled operation and 64 MB per snapshot
upload; presence at up to 30 updates/second per participant (coalesced
client-side). Mutation throughput is bounded by per-connection token buckets;
a single client cannot starve the room because ordering is serialized per
append and each participant has its own outbound queue.

Nothing here is benchmarked for large participant counts: the documented
participant ceiling is 10, and this repository does not publish throughput
measurements for larger rooms. Treat the limits above as enforced bounds, not
as performance promises.
