# Connecting an agent to Varve

How to let a program on your own computer inspect and edit a document, what each
permission means, and how to recover when something goes wrong. The contract
behind this is [agent-control-system.md](../architecture/agent-control-system.md);
this page is the practical side.

Everything here is local. Nothing listens on a network port, and a browser tab
cannot accept a connection at all: attaching to a running window needs the
desktop application.

## Two ways to work

| | Headless | Attached |
|---|---|---|
| What it is | An isolated copy of a document opened by `varve` itself | The window you have open |
| Start | `varve mcp --file <doc>` or `--new <name>` | Turn on Settings > Agent Access, then `varve mcp --instance <id>` |
| Sees your unsaved edits | No | Yes |
| Can render images | No | Yes, with the images permission |
| Saves | Only with `--in-place` / `--out`, or the `serve`/`mcp` save command | Only to the file you already chose, with the save permission |

The two are never swapped silently. An attached client that cannot find the
window exits with an error; it does not open an empty document instead.

## Turn it on (attached)

1. Open the document you want to share. The endpoint follows the document you
   are showing; opening a different one disconnects clients and issues a new
   credential.
2. Settings > Agent Access. Switch **Allow local agents to connect** on. The
   state line changes to **Running** and shows the attach command.
3. Choose what an agent may do. Each switch grants exactly one thing:

   | Switch | Grants | Default |
   |---|---|---|
   | Allow agents to make changes | Edit the document. One undo step per command or batch. | Off (read only) |
   | Allow agents to save | Save to the file you already chose. Never a path the agent picks. Needs changes allowed. | Off |
   | Ask me before each change | Hold every change and save until you approve it. | On |
   | Allow agents to take images | Render one node to a PNG. Not a picture of your screen. | Off |

4. A held change appears under **Waiting for your approval** with the command,
   the document, the revision it was planned against and its arguments as plain
   text. **Approve** applies it only if the document has not moved since;
   **Decline** refuses it. A held change that nobody answers is refused after
   five minutes.

**Pause changes** blocks new changes and saves while reads keep working, so a
paused agent can still see why, and it withdraws anything already waiting for your
approval. **Disconnect and block** closes one client and refuses the access key it
used. Every agent attached to a window shares that one key, so the block applies to
all of them until you choose **Allow access again**; it also withdraws that client's
waiting requests. Turning the main switch off disconnects everyone and issues a new
key. None of these undo what was already done.

## Register it in a client

`varve config mcp` prints what a client needs, with the real paths of the program
that is running. It writes nothing and edits no client.

```
varve config mcp --instance <id from Settings> --client generic
varve config mcp --instance <id> --client vscode
varve config mcp --instance <id> --client claude-code     # prints a `claude mcp add` command
varve config mcp --file "My Poster.varve" --grant read    # headless
```

Paste the result where your client keeps its servers, or run the printed command
yourself. Paths with spaces are handled; the program does not need to be on
`PATH`. `--grant` is optional and defaults to the server's read-only default.

Readiness is three separate questions, and none of them answers the others:

1. **Is the local protocol ready?** `varve doctor`
2. **Is the intended window reachable?** `varve instances --verify`
3. **Is it registered?** Look in the client's own server list.

## What an agent can do today

Discover with `varve_search_commands` and `varve_describe_command`, then act with
`varve_query`, `varve_invoke` and `varve_batch`.

- Read: document info, node list/get/find, transaction history.
- Edit: create, set, move, resize, delete, reorder, reparent; roll back its own
  changes by transaction id.
- Save and capture, with their permissions, in an attached window.

Everything else in the editor is not yet a command. The exact numbers, and the
dated backlog, are in
[agent-parity-coverage-2026-10-15.md](../audits/agent-parity-coverage-2026-10-15.md).

## Recovery

| Situation | What to do |
|---|---|
| An agent did something you do not want | Undo (Ctrl+Z) removes one agent change, because each is one undo step. Or ask it to `varve.history.rollback` the transaction; a rollback refuses rather than overwrite a field you changed since. |
| You want it to stop now | **Pause changes**, or switch Agent Access off. Committed work stays. |
| A client lost the reply to an edit | It retries with the same `idempotencyKey` and `attempt: 2`. A known edit is replayed; an unknown one is reported as `OUTCOME_UNKNOWN` so it can read the revision and history instead of repeating the edit. |
| A change was refused with `REVISION_CONFLICT` | The document moved after the agent looked. Read again and re-plan. |
| A change was refused with `CONFLICT` and `retryable` | You were in the middle of a drag or text edit. It succeeds on retry once you finish. |
| Save says nothing was written | The document has no chosen destination, or the file changed on disk. Save once yourself from the File menu. |
| A stale endpoint is listed | `varve instances --verify` marks which are alive. A dead one is only a leftover directory; nothing is listening. |
| The attach command stopped working after you opened another document | Expected: the credential was replaced. Copy the command again. |

## Security notes

- The credential lives in a file only your user can read and is never shown in
  the window. The window shows the attach command, not a secret.
- A request cannot name its own identity, grant itself more access, approve its
  own change, or change these settings. There is no command for any of them.
- A program running as you, with your permissions, can read the same files you
  can. This stops accidents and other websites; it is not a sandbox against
  malware that is already you.
- Text, layer names and other document content reach an agent as data. The
  agent's own model may send what it reads or any image to its provider.

## Verified, and not

Verified on Linux in the launched desktop application (WebKitGTK under Xvfb): the
setting starts a real endpoint; `varve instances --verify` and a separate client
process attach to the open document; a change is held, approved with a real click
and appears in the Layers panel; a capture returns native pixels in the requested
colour; pausing refuses changes; and switching off removes the endpoint. To rerun
it, build the debug app with the WebDriver feature and use an isolated profile
(the full command is in the header of `tests/wdio/agent-access.e2e.ts`).

Stated so a missing check is never mistaken for a pass: macOS and Windows have not
been run, and Windows has no transport (named pipes are not implemented);
installer-packaged launches are untested; Claude Desktop, Cursor and VS Code were
not available for a real registration test; and the document must have been opened
in the window before a client attaches.
