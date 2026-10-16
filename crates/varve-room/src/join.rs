//! The invite landing surface (`/join`).
//!
//! Invite links are `<server>/join#room=<id>&t=<token>`. Before this route
//! existed the link pointed at a 404: the room host served only `/health`,
//! `/ready`, `/room/{id}`, and the admin API, so "copy invite link" produced a
//! dead URL.
//!
//! Security shape of this page:
//! - The token lives in the URL **fragment**, which browsers never send to the
//!   server. The page therefore reads it locally and never transmits it; the
//!   host has no idea which invite a visitor holds.
//! - Everything is rendered with `textContent`, never `innerHTML`, so a
//!   crafted fragment cannot inject markup.
//! - The CSP allows no network of any kind (`default-src 'none'`): the page
//!   cannot phone home with the token, and there is nothing to exfiltrate it
//!   to. Scripts and styles come from this origin only.
//! - The page is a landing surface, not an editor. It states plainly where the
//!   client lives rather than implying a browser client that does not ship.

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

const JOIN_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Varve collaboration invite</title>
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/join.css">
<script src="/join.js" defer></script>
</head>
<body>
<main>
  <h1>Varve collaboration invite</h1>
  <p id="intro" class="lead">
    This link carries a session invite. Nothing is sent to the server from this
    page: the invite token stays in the URL fragment in your browser.
  </p>

  <section id="missing" hidden>
    <h2>The link is incomplete</h2>
    <p>
      An invite link looks like <code>/join#room=&lt;id&gt;&amp;t=&lt;token&gt;</code>.
      Ask the person who shared it to copy the link again from their Share dialog.
    </p>
  </section>

  <section id="invite" hidden>
    <h2>Join details</h2>
    <dl>
      <dt>Room server</dt>
      <dd><code id="server"></code></dd>
      <dt>Room id</dt>
      <dd><code id="room"></code></dd>
      <dt>Invite token</dt>
      <dd class="token-row">
        <code id="token" class="token"></code>
        <button type="button" id="reveal" aria-pressed="false">Show</button>
        <button type="button" id="copy-token">Copy token</button>
      </dd>
    </dl>
    <h3>How to join</h3>
    <ol>
      <li>Open the Varve desktop app.</li>
      <li>Open <strong>Share and collaborate</strong>, then the <strong>Join</strong> tab.</li>
      <li>Paste the room server, room id, and invite token above.</li>
    </ol>
    <div class="actions">
      <button type="button" id="copy-all">Copy all join details</button>
    </div>
    <p id="copy-status" role="status" aria-live="polite"></p>
  </section>

  <section>
    <h2>What this link grants</h2>
    <ul>
      <li>Anyone holding the token can join until the invite expires or is revoked.</li>
      <li>
        The role comes from the token: editors can change the document, viewers
        can watch and use cursor chat. The session host enforces that on every
        change; hiding a button is not the boundary.
      </li>
      <li>Revoking an invite disconnects its live sessions, but cannot recall copies already received.</li>
      <li>The session host stores the document in plain text. This is not end-to-end encrypted.</li>
    </ul>
  </section>

  <p class="note">
    This page is a landing surface, not the editor: real-time editing in a
    browser is not part of this release. Use the Varve desktop app, or a build
    of the web client that reports collaboration support.
  </p>
</main>
</body>
</html>
"#;

const JOIN_JS: &str = r#"// Invite landing surface. Reads the invite from the URL fragment (never sent
// to any server) and renders it with textContent only.
(function () {
  'use strict';
  var params = new URLSearchParams(
    location.hash.charAt(0) === '#' ? location.hash.slice(1) : location.hash
  );
  var room = params.get('room') || '';
  var token = params.get('t') || '';
  var server = location.origin;

  function text(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  var invite = document.getElementById('invite');
  var missing = document.getElementById('missing');
  if (!room || !token) {
    if (missing) missing.hidden = false;
    return;
  }
  if (invite) invite.hidden = false;

  text('server', server);
  text('room', room);

  var tokenNode = document.getElementById('token');
  var revealed = false;
  function paintToken() {
    if (!tokenNode) return;
    // The token is long; showing it masked by default keeps it out of
    // shoulder-surfing range and out of most screenshots.
    tokenNode.textContent = revealed ? token : token.slice(0, 4) + '…' + token.slice(-4);
    tokenNode.setAttribute('data-full-length', String(token.length));
  }
  paintToken();

  var reveal = document.getElementById('reveal');
  if (reveal) {
    reveal.addEventListener('click', function () {
      revealed = !revealed;
      reveal.setAttribute('aria-pressed', revealed ? 'true' : 'false');
      reveal.textContent = revealed ? 'Hide' : 'Show';
      paintToken();
    });
  }

  var status = document.getElementById('copy-status');
  function announce(message) {
    if (status) status.textContent = message;
  }

  function copy(value, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { announce(label + ' copied.'); },
        function () { announce('Copy failed; select the text and copy it manually.'); }
      );
      return;
    }
    announce('Copy is unavailable here; select the text and copy it manually.');
  }

  var copyToken = document.getElementById('copy-token');
  if (copyToken) {
    copyToken.addEventListener('click', function () { copy(token, 'Invite token'); });
  }
  var copyAll = document.getElementById('copy-all');
  if (copyAll) {
    copyAll.addEventListener('click', function () {
      copy(
        'Room server: ' + server + '\nRoom id: ' + room + '\nInvite token: ' + token,
        'Join details'
      );
    });
  }
})();
"#;

const JOIN_CSS: &str = r#":root {
  color-scheme: light dark;
  --fg: #14171a;
  --muted: #5b6470;
  --bg: #ffffff;
  --panel: #f4f6f8;
  --line: #d3d9e0;
  --accent: #0f7a72;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #eef1f4;
    --muted: #a3adba;
    --bg: #16191d;
    --panel: #1e2329;
    --line: #333a42;
    --accent: #4fd1c5;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1rem 4rem;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 44rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
h2 { font-size: 1.1rem; margin: 1.75rem 0 .5rem; }
h3 { font-size: 1rem; margin: 1.25rem 0 .5rem; }
.lead { color: var(--muted); }
section { border-top: 1px solid var(--line); padding-top: .5rem; }
dl { display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: .4rem 1rem; margin: .5rem 0 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: .92em;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: .35rem;
  padding: .1rem .35rem;
}
.token-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.token { display: inline-block; max-width: 100%; }
button {
  font: inherit;
  color: var(--fg);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: .4rem;
  padding: .3rem .7rem;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.actions { margin-top: 1rem; }
.note, #copy-status { color: var(--muted); }
#copy-status:empty { display: none; }
[hidden] { display: none !important; }
"#;

/// CSP for the invite surface: no network of any kind, same-origin assets
/// only, and no way to frame or submit the page elsewhere.
const JOIN_CSP: &str =
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; \
     connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

fn asset(body: &'static str, content_type: &'static str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_SECURITY_POLICY, JOIN_CSP),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
        body,
    )
        .into_response()
}

pub async fn join_page() -> Response {
    asset(JOIN_HTML, "text/html; charset=utf-8")
}

pub async fn join_script() -> Response {
    asset(JOIN_JS, "text/javascript; charset=utf-8")
}

pub async fn join_styles() -> Response {
    asset(JOIN_CSS, "text/css; charset=utf-8")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn every_asset_carries_the_locking_csp() {
        for response in [join_page().await, join_script().await, join_styles().await] {
            let csp = response
                .headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_string();
            assert!(csp.contains("default-src 'none'"), "csp: {csp}");
            assert!(csp.contains("connect-src 'none'"), "csp: {csp}");
            assert!(csp.contains("frame-ancestors 'none'"), "csp: {csp}");
        }
    }

    #[test]
    fn the_page_never_interpolates_the_fragment_into_markup() {
        // The invite values are rendered from /join.js with textContent, so
        // the server-rendered HTML must contain no placeholder for them.
        assert!(!JOIN_HTML.contains("innerHTML"));
        assert!(JOIN_JS.contains("textContent"));
        assert!(!JOIN_JS.contains("innerHTML"));
        assert!(!JOIN_JS.contains("document.write"));
    }
}
