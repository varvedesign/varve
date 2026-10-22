#!/usr/bin/env node
/**
 * Make Playwright's bundled WebKit launchable on a distribution whose system
 * libraries do not match the build.
 *
 * Playwright's WebKit archive is built against ICU 74 and a set of CMU flite
 * voice libraries. A rolling distribution ships ICU 78 (symbol-versioned
 * `u_strToUpper_78`, so a symlink is not a shim — it fails at symbol lookup)
 * and packages only some of the flite voices. Playwright's own host-requirement
 * check cannot help: it looks for Debian package names via `dpkg`, so on Arch it
 * refuses to start even when every library resolves.
 *
 * The WPE build that Playwright uses for `--headless` additionally needs the
 * whole WPE stack (`libWPEWebKit-2.0`, `libwpe`, `libWPEBackend-fdo`), which is
 * not installable without root. The GTK build — the same engine family the
 * Tauri desktop app embeds — only needs the libraries this script provides, and
 * runs headed under Xvfb.
 *
 * Everything here is userland: an ICU 74 package is downloaded and extracted
 * into a cache directory, tiny stubs satisfy the unused TTS voice symbols, and
 * symlinks are placed in the WebKit bundle's own `sys/lib`, which its launcher
 * puts first on `LD_LIBRARY_PATH`. Nothing outside `~/.cache` and the user's
 * Playwright cache is touched, and no package manager is invoked.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE = join(homedir(), '.cache', 'varve', 'playwright-webkit');
const PLAYWRIGHT_CACHE = join(homedir(), '.cache', 'ms-playwright');

/** ICU 74 as shipped by Ubuntu 24.04 (noble). Debian's pool has moved on. */
const ICU_DEB_URL =
  'http://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu74_74.2-1ubuntu3.1_amd64.deb';
const ICU_DEB_NAME = ICU_DEB_URL.split('/').pop();

const ICU_LIBS = ['libicudata', 'libicui18n', 'libicuuc', 'libicuio', 'libicutu'];

/**
 * Voice libraries WebKit links for speech synthesis. The distributions that
 * package `flite` ship only some of them; the registration symbols are the
 * only ones WebKit references, so a stub is sufficient for a browser we only
 * use to exercise the editor.
 */
const FLITE_STUBS = {
  libflite_cmu_us_awb: 'register_cmu_us_awb',
  libflite_cmu_us_kal: 'register_cmu_us_kal',
  libflite_cmu_us_rms: 'register_cmu_us_rms',
};
const FLITE_EMPTY = [
  'libflite_cmu_grapheme_lang',
  'libflite_cmu_grapheme_lex',
  'libflite_cmu_time_awb',
];

function log(message) {
  console.log(`webkit-libs: ${message}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
}

function has(command) {
  try {
    run('sh', ['-c', `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

/** Locate the newest installed Playwright WebKit bundle. */
function findWebkitBundle() {
  if (!existsSync(PLAYWRIGHT_CACHE)) return null;
  const candidates = readdirSync(PLAYWRIGHT_CACHE)
    .filter((entry) => entry.startsWith('webkit-'))
    .sort()
    .reverse();
  for (const candidate of candidates) {
    const dir = join(PLAYWRIGHT_CACHE, candidate, 'minibrowser-gtk');
    if (existsSync(join(dir, 'MiniBrowser'))) return { name: candidate, dir };
  }
  return null;
}

function ensureIcu() {
  const libDir = join(CACHE, 'icu74', 'usr', 'lib', 'x86_64-linux-gnu');
  if (ICU_LIBS.every((lib) => existsSync(join(libDir, `${lib}.so.74`)))) {
    log('ICU 74 already present');
    return libDir;
  }
  if (!has('curl') || !has('ar') || !has('tar')) {
    throw new Error('curl, ar and tar are required to fetch an ICU 74 build.');
  }
  mkdirSync(CACHE, { recursive: true });
  const debPath = join(CACHE, ICU_DEB_NAME);
  if (!existsSync(debPath)) {
    log(`downloading ICU 74 (${ICU_DEB_NAME})`);
    run('curl', ['-fsSL', '-o', debPath, ICU_DEB_URL], { stdio: 'inherit' });
  }
  log('extracting');
  const extractDir = join(CACHE, 'icu74');
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  run('ar', ['x', debPath], { cwd: extractDir });
  const dataArchive = readdirSync(extractDir).find((entry) => entry.startsWith('data.tar'));
  if (!dataArchive) throw new Error('ICU package has no data.tar entry.');
  run('tar', ['-xf', dataArchive, '-C', extractDir], { cwd: extractDir });
  if (!existsSync(join(libDir, 'libicuuc.so.74'))) {
    throw new Error(`ICU 74 extraction did not produce ${libDir}/libicuuc.so.74`);
  }
  return libDir;
}

/** Build the flite stand-ins once, into the cache. */
function ensureFliteStubs() {
  const stubDir = join(CACHE, 'flite');
  const complete = [...Object.keys(FLITE_STUBS), ...FLITE_EMPTY].every((name) =>
    existsSync(join(stubDir, `${name}.so.1`)),
  );
  if (complete) {
    log('flite stand-ins already present');
    return stubDir;
  }
  if (!has('gcc')) {
    throw new Error(
      'gcc is required to build flite stand-ins. Install gcc, or install the flite CMU voice packages.',
    );
  }
  mkdirSync(stubDir, { recursive: true });
  for (const [name, symbol] of Object.entries(FLITE_STUBS)) {
    const source = join(stubDir, `${name}.c`);
    writeFileSync(
      source,
      `/* Loader stand-in: WebKitGTK links this TTS voice; the editor never speaks. */\n#include <stddef.h>\nvoid *${symbol}(void) { return NULL; }\n`,
    );
    run('gcc', ['-shared', '-fPIC', '-o', join(stubDir, `${name}.so.1`), source], {
      stdio: 'inherit',
    });
  }
  for (const name of FLITE_EMPTY) {
    const source = join(stubDir, `${name}.c`);
    writeFileSync(
      source,
      '/* Loader placeholder: no symbol is referenced. */\nint varve_placeholder;\n',
    );
    run('gcc', ['-shared', '-fPIC', '-o', join(stubDir, `${name}.so.1`), source], {
      stdio: 'inherit',
    });
  }
  return stubDir;
}

function linkIntoWebkit(sysLibDir, icuDir, fliteDir) {
  mkdirSync(sysLibDir, { recursive: true });
  let linked = 0;
  const link = (target, name) => {
    const destination = join(sysLibDir, name);
    try {
      if (existsSync(destination)) unlinkSync(destination);
      symlinkSync(target, destination);
      linked += 1;
    } catch (error) {
      throw new Error(`cannot link ${name}: ${error.message}`);
    }
  };

  for (const lib of ICU_LIBS) {
    const target = join(icuDir, `${lib}.so.74`);
    if (!existsSync(target)) continue;
    link(target, `${lib}.so.74`);
  }

  // Real system flite where the distribution packages it; stubs only for the
  // voice libraries it does not.
  for (const [name] of Object.entries(FLITE_STUBS)) {
    const system = `/usr/lib/${name}.so.1`;
    link(existsSync(system) ? system : join(fliteDir, `${name}.so.1`), `${name}.so.1`);
  }
  for (const name of FLITE_EMPTY) link(join(fliteDir, `${name}.so.1`), `${name}.so.1`);
  for (const name of ['libflite', 'libflite_cmulex', 'libflite_usenglish']) {
    const system = `/usr/lib/${name}.so.1`;
    if (existsSync(system)) link(system, `${name}.so.1`);
  }
  // WebKit's dmz wants a versioned libxml2; the distribution's is newer but
  // ABI-compatible for the symbols it imports (it warns, it does not fail).
  for (const candidate of ['/usr/lib/libxml2.so.2', '/usr/lib/libxml2.so.16']) {
    if (existsSync(candidate)) {
      link(candidate, 'libxml2.so.2');
      break;
    }
  }
  return linked;
}

function main() {
  if (process.platform !== 'linux') {
    log('not Linux; nothing to provision');
    return;
  }
  const bundle = findWebkitBundle();
  if (!bundle) {
    throw new Error(
      `no Playwright WebKit bundle found under ${PLAYWRIGHT_CACHE}. Run "npx playwright install webkit" first.`,
    );
  }
  const icuDir = ensureIcu();
  const fliteDir = ensureFliteStubs();
  const linked = linkIntoWebkit(join(bundle.dir, 'sys', 'lib'), icuDir, fliteDir);
  log(`${bundle.name}: linked ${linked} libraries`);

  // Confirm the loader is satisfied rather than trusting the links.
  const readelf = join(bundle.dir, 'bin', 'MiniBrowser');
  if (existsSync(readelf) && has('ldd')) {
    const output = run('ldd', [readelf], {
      cwd: bundle.dir,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: `${join(bundle.dir, 'lib')}:${join(bundle.dir, 'sys', 'lib')}`,
      },
    });
    const missing = output
      .split('\n')
      .filter((line) => line.includes('not found'))
      .map((line) => line.trim());
    if (missing.length > 0) {
      console.error('webkit-libs: unresolved after provisioning:');
      for (const line of missing) console.error(`  ${line}`);
      process.exit(1);
    }
    log('all shared libraries resolve');
  }
  log('done. Launch the GTK build headed, under a display:');
  console.log('  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \\');
  console.log(
    '    xvfb-run -a npx playwright test tests/e2e/canvas/font-availability.spec.ts --project=webkit-gtk',
  );
}

try {
  main();
} catch (error) {
  console.error(`webkit-libs: ${error.message}`);
  process.exit(1);
}
