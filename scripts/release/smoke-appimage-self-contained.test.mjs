#!/usr/bin/env node
/**
 * Behavior tests for the AppImageHub-shaped smoke probe.
 * Exercises DISPLAY isolation, window + WebKit helper requirements, and
 * spawn/EGL failures. Does not launch a container.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const probe = join(root, 'scripts/release/smoke-appimage-probe.sh');
const orchestrator = readFileSync(
  join(root, 'scripts/release/smoke-appimage-self-contained.sh'),
  'utf8',
);
const ubuntu = readFileSync(join(root, 'scripts/release/appimage-smoke.Containerfile'), 'utf8');
const fedora = readFileSync(
  join(root, 'scripts/release/appimage-smoke-fedora.Containerfile'),
  'utf8',
);
const releaseWorkflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const buildWorkflow = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8');

function writeExec(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function runProbe({ display = ':99', bins = {}, appBody, seconds = 3, webkitSeconds = 1 }) {
  const work = mkdtempSync(join(tmpdir(), 'varve-appimage-probe-'));
  try {
    const bin = join(work, 'bin');
    mkdirSync(bin);
    writeExec(
      join(bin, 'xwininfo'),
      bins.xwininfo ?? '#!/bin/sh\nprintf "%s\\n" "  0x200000 \\"Varve\\""\n',
    );
    writeExec(
      join(bin, 'pgrep'),
      bins.pgrep ??
        `#!/bin/sh
case "$*" in
  *WebKitWebProcess*) echo 1 ;;
  *WebKitNetworkProcess*) echo 1 ;;
  *) echo 0 ;;
esac
`,
    );
    writeExec(join(bin, 'ps'), '#!/bin/sh\necho mock-ps\n');
    const app = join(work, 'Varve.AppImage');
    writeExec(app, appBody ?? '#!/bin/sh\nexec sleep 30\n');
    const result = spawnSync('bash', [probe, '--appimage', app, '--seconds', String(seconds)], {
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DISPLAY: display,
        HOLD_WEBKIT_SECONDS: String(webkitSeconds),
        VARVE_APPIMAGE_PROBE_LOG: join(work, 'app.log'),
      },
    });
    return result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  const missing = spawnSync('bash', [probe, '--appimage', probe, '--seconds', '1'], {
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env, DISPLAY: '', HOLD_WEBKIT_SECONDS: '1' },
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /DISPLAY is unset/);
}

{
  const ok = runProbe({});
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.match(ok.stdout, /WINDOW_OK web_processes=1 network_processes=1/);
}

{
  const windowOnly = runProbe({
    bins: {
      pgrep: `#!/bin/sh
echo 0
`,
    },
  });
  assert.notEqual(windowOnly.status, 0);
  assert.match(windowOnly.stderr, /WebKit helpers were missing/);
  assert.doesNotMatch(windowOnly.stdout, /WINDOW_OK/);
}

{
  const webOnly = runProbe({
    bins: {
      pgrep: `#!/bin/sh
case "$*" in
  *WebKitWebProcess*) echo 1 ;;
  *) echo 0 ;;
esac
`,
    },
  });
  assert.notEqual(webOnly.status, 0);
  assert.match(webOnly.stderr, /WebKit helpers were missing/);
}

{
  const noWindow = runProbe({
    bins: { xwininfo: '#!/bin/sh\nprintf "%s\\n" "  0x1 \\"twm\\""\n' },
  });
  assert.notEqual(noWindow.status, 0);
  assert.match(noWindow.stderr, /No window after/);
}

{
  const egl = runProbe({
    appBody: `#!/bin/sh
echo "Could not create default EGL display: EGL_BAD_PARAMETER. Aborting..." >&2
exec sleep 30
`,
  });
  assert.notEqual(egl.status, 0);
  assert.match(egl.stderr, /WebKit\/EGL\/spawn failure/);
}

{
  const spawnFail = runProbe({
    appBody: `#!/bin/sh
echo "Unable to spawn a new child process" >&2
exec sleep 30
`,
  });
  assert.notEqual(spawnFail.status, 0);
  assert.match(spawnFail.stderr, /WebKit\/EGL\/spawn failure/);
}

assert.match(orchestrator, /--network none/);
assert.match(orchestrator, /smoke-appimage-with-display\.sh/);
assert.match(orchestrator, /smoke-appimage-probe\.sh/);
assert.match(orchestrator, /--distro/);
assert.match(orchestrator, /--log-dir/);
assert.match(orchestrator, /fedora/);
assert.match(orchestrator, />"\$log" 2>&1/);
assert.doesNotMatch(orchestrator, /xvfb-run/);
assert.doesNotMatch(orchestrator, /WEBKIT_DISABLE_SANDBOX/);
assert.doesNotMatch(readFileSync(probe, 'utf8'), /WEBKIT_DISABLE_SANDBOX/);
assert.doesNotMatch(orchestrator, /chmod \+x \/opt\/Varve\.AppImage/);
assert.match(
  readFileSync(join(root, 'scripts/release/smoke-appimage-with-display.sh'), 'utf8'),
  /Xvfb "\$DISPLAY" -screen 0 1280x800x24/,
);

assert.match(ubuntu, /FROM docker\.io\/library\/ubuntu:22\.04/);
assert.match(ubuntu, /libgl1-mesa-dri/);
assert.match(ubuntu, /libglx-mesa0/);
assert.match(ubuntu, /libwayland-cursor0/);
assert.match(ubuntu, /libwayland-egl1/);
assert.match(ubuntu, /libwayland-server0/);
assert.doesNotMatch(ubuntu, /libwebkit2gtk-4/);
assert.match(ubuntu, /libwebkit2gtk must not be installed/);

assert.match(fedora, /FROM docker\.io\/library\/fedora:latest/);
assert.match(fedora, /mesa-dri-drivers/);
assert.match(fedora, /libwayland-cursor/);
assert.match(fedora, /libwayland-egl/);
assert.match(fedora, /libwayland-server/);
assert.match(fedora, /webkit2gtk must not be installed/);
assert.match(fedora, /gtk3 must not be installed/);

assert.match(releaseWorkflow, /smoke-appimage-self-contained\.sh/);
assert.match(releaseWorkflow, /--distro all/);
assert.match(releaseWorkflow, /ensure-linuxdeploy-plugin-gtk\.mjs/);
assert.match(buildWorkflow, /Linux AppImage \(offline smoke\)/);
assert.match(buildWorkflow, /runs-on: ubuntu-22\.04/);
assert.match(buildWorkflow, /createUpdaterArtifacts":false/);
assert.match(buildWorkflow, /smoke-appimage-self-contained\.sh/);
assert.match(buildWorkflow, /--appimage "\$\{IMG\}"/);
assert.match(buildWorkflow, /--distro all/);
assert.doesNotMatch(buildWorkflow, /action-gh-release/);
assert.doesNotMatch(buildWorkflow, /softprops\/action-gh-release/);
assert.doesNotMatch(buildWorkflow, /contents:\s*write/);

console.log('smoke-appimage-self-contained tests passed');
