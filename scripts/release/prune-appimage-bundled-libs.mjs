#!/usr/bin/env node
/**
 * Prepare the AppImage payload: keep WebKit/GTK, drop the host GPU stack.
 *
 * Why this exists:
 *
 * Tauri's AppImage pipeline runs linuxdeploy-plugin-gtk, which bundles the
 * whole GTK/WebKit/GStreamer dependency closure built on the CI baseline
 * (ubuntu-22.04). That closure also carries Mesa/EGL from the build host.
 * On distributions with a newer Mesa/EGL stack (Arch, CachyOS, Fedora 40+,
 * Ubuntu 24.04) the bundled WebKitWebProcess then fails at startup:
 *
 *     Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
 *
 * v0.1.1–v0.5.1 deleted the *entire* usr/lib stack (`--exclude-library '*'`)
 * so the AppImage used host WebKit like the .deb. That fixed the white
 * screen and broke AppImageHub: a clean offline VM has no
 * `libwebkit2gtk-4.1.so.0`, so the 0.5.1 catalog test exited before a
 * window appeared.
 *
 * The split that satisfies both:
 *   - Keep WebKitGTK, GTK, GStreamer, and the rest of the toolkit closure
 *     so a machine without those packages can still launch.
 *   - Delete only the GPU/EGL/Mesa/DRI/Vulkan libraries (and nvidia/cuda)
 *     so WebKit talks to the *host* libEGL. libc stays unbundled (linuxdeploy
 *     default); AppImageHub's glibc-2.35 note is expected.
 *   - Re-assemble with `--exclude-library '*'` so linuxdeploy cannot copy
 *     the build host's Mesa back in.
 *
 * `WEBKIT_DISABLE_DMABUF_RENDERER=1` (APPIMAGE-gated in lib.rs) remains the
 * compositor fallback once EGL display creation succeeds against host Mesa.
 *
 * Resource preservation (fixed 2026-09-12): Tauri installs `bundle.resources`
 * under `usr/lib/<productName>/`. Never delete that tree. Foreign ONNX
 * runtime directories from a reused AppDir are still stripped.
 *
 * Runs after `tauri build` on the Linux bundle directory, before collection.
 * Always normalises AppDir modes before pack (firejail / AppImageHub).
 *
 *   node scripts/release/prune-appimage-bundled-libs.mjs \
 *     --bundle-dir apps/desktop/src-tauri/target/release/bundle \
 *     [--tools-dir ~/.cache/tauri]
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArchitecture, normalizeTargetId, targetIdFor } from './targets.mjs';
import { verifyAppImagePermissions } from './verify-appimage-permissions.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAURI_CONF = join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');

/** AppStream `<launchable type="desktop-id">` and the AUR/Flatpak desktop name. */
export const APPSTREAM_DESKTOP_ID = 'dev.varve.desktop.desktop';
/** Filename Tauri's AppImage bundler writes from `productName`. */
export const TAURI_APPIMAGE_DESKTOP_NAME = 'Varve.desktop';
const LAUNCHER_PATHS = ['AppRun', 'AppRun.wrapped', 'usr/bin/varve-desktop'];
const STRAY_BUILD_FILE_NAMES = new Set(['varve-generative-helper.d']);

/**
 * GPU/display-driver libraries that must come from the host. Matching is on
 * the basename only so a future `libGL-extra.so` does not hide inside
 * `libglib`. libGL / libEGL prefixes are exact SONAME families, not `libg*`.
 */
export const HOST_GRAPHICS_FILE_RE =
  /^(?:libEGL(?:_[^.]+)?|libGL(?:U|X(?:_[^.]+)?|ES(?:v1_CM|v2)|dispatch|api)?|libOpenGL|libglapi|libdrm(?:_[^.]+)?|libgbm|libvulkan|libnvidia.*|libcuda.*)(?:\.so(?:\..*)?)?$/;

/**
 * Host C++ / Wayland / display libs. If the 22.04 copies stay in the AppImage
 * they shadow a newer host Mesa via LD_LIBRARY_PATH (GLIBCXX_3.4.3x, Wayland
 * symbol mismatches) and recreate the white-screen failure.
 */
export const HOST_SYSTEM_FILE_RE =
  /^(?:libstdc\+\+|libgcc_s|libwayland(?:-[^.]+)?)(?:\.so(?:\..*)?)?$/;

export const HOST_GRAPHICS_DIR_NAMES = new Set(['dri', 'mesa', 'nvidia', 'glvnd']);

export function isHostGraphicsLibraryName(name) {
  return HOST_GRAPHICS_FILE_RE.test(name);
}

export function isHostSystemLibraryName(name) {
  return HOST_SYSTEM_FILE_RE.test(name);
}

export function isHostProvidedLibraryName(name) {
  return isHostGraphicsLibraryName(name) || isHostSystemLibraryName(name);
}

/** glibc / loader family. linuxdeploy leaves these on the host. */
export const LIBC_FAMILY_FILE_RE =
  /^(?:ld-linux.*|libc|libm|libdl|libpthread|librt|libresolv|libanl|libutil|libnss_.*|libnsl)(?:\.so(?:\..*)?)?$/;

export function isLibcFamilyLibraryName(name) {
  return LIBC_FAMILY_FILE_RE.test(name);
}

/**
 * Missing DT_NEEDED entries that must be copied from the ubuntu-22.04 build
 * host into the AppDir. GPU / C++ ABI / Wayland / libc stay on the running
 * system so a newer Mesa is not shadowed.
 */
export function shouldCopyMissingDependency(soname) {
  return !isLibcFamilyLibraryName(soname) && !isHostProvidedLibraryName(soname);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function findAppImage(bundleDir) {
  const appImageDir = join(bundleDir, 'appimage');
  if (!existsSync(appImageDir)) return null;
  return readdirSync(appImageDir).find((f) => f.endsWith('.AppImage'));
}

function findTool(toolsDir, names) {
  for (const name of names) {
    const p = join(toolsDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Tauri installs `bundle.resources` under `usr/lib/<productName>/` on Linux
 * (verified against the v0.2.1 .deb: `/usr/lib/Varve/onnxruntime-libs/...`).
 * The AppImage uses the same AppDir layout, so the product name is also the
 * resource directory name there.
 */
export function resolveLinuxResourceDirName(tauriConfPath = TAURI_CONF) {
  if (!existsSync(tauriConfPath)) return null;
  const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  return typeof conf.productName === 'string' && conf.productName.length > 0
    ? conf.productName
    : null;
}

/**
 * Decide which entries under `usr/lib`/`usr/lib64` to remove and which to
 * keep. Keep the product resource directory and the WebKit/GTK/GStreamer
 * closure. Remove only host GPU/EGL/Mesa/DRI/Vulkan libraries so bundled
 * WebKit talks to the running system's graphics stack.
 */
export function collectPrunePlan(squashfsRoot, resourceDirName) {
  const remove = [];
  const keep = [];
  const productLib = resourceDirName ? join(squashfsRoot, 'usr', 'lib', resourceDirName) : null;

  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (productLib && full === productLib) {
        keep.push(full);
        continue;
      }
      if (HOST_GRAPHICS_DIR_NAMES.has(entry.name)) {
        remove.push(full);
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(full);
        continue;
      }
      if (isHostProvidedLibraryName(entry.name)) remove.push(full);
    }
  }

  for (const dirName of ['lib', 'lib64']) {
    walk(join(squashfsRoot, 'usr', dirName));
  }
  return { remove, keep };
}

const WEBKIT_HELPER_DIR = 'webkit2gtk-4.1';
const WEBKIT_PATCH_MARKER = '././/lib/';
const WEBKIT_UNPATCHED_PATH = /\/usr\/lib\/[^/\0]+\/webkit2gtk-4\.1/;

export function findWebKitHelperDir(squashfsRoot) {
  const libRoot = join(squashfsRoot, 'usr', 'lib');
  if (!existsSync(libRoot)) return null;
  for (const entry of readdirSync(libRoot, { withFileTypes: true })) {
    const candidate = join(libRoot, entry.name, WEBKIT_HELPER_DIR);
    if (existsSync(candidate)) return candidate;
  }
  const fallback = join(libRoot, WEBKIT_HELPER_DIR);
  return existsSync(fallback) ? fallback : null;
}

export function findBundledWebKit(squashfsRoot) {
  const libraries = [];
  const javascriptcore = [];
  const webProcess = [];
  const networkProcess = [];
  const storageProcess = [];
  const injectedBundles = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(full);
        continue;
      }
      if (/^libwebkit2gtk-4\.1\.so/.test(entry.name)) libraries.push(full);
      if (/^libjavascriptcoregtk-4\.1\.so/.test(entry.name)) javascriptcore.push(full);
      if (entry.name === 'WebKitWebProcess') webProcess.push(full);
      if (entry.name === 'WebKitNetworkProcess') networkProcess.push(full);
      if (entry.name === 'WebKitStorageProcess') storageProcess.push(full);
      if (entry.name === 'libwebkit2gtkinjectedbundle.so') injectedBundles.push(full);
    }
  }
  walk(join(squashfsRoot, 'usr'));
  return {
    libraries,
    javascriptcore,
    webProcess,
    networkProcess,
    storageProcess,
    injectedBundles,
    helperDir: findWebKitHelperDir(squashfsRoot),
    helpers: [...webProcess, ...networkProcess, ...storageProcess],
  };
}

export function assertWebKitPathPatch(libraryPath, label) {
  const text = readFileSync(libraryPath).toString('latin1');
  if (!text.includes(WEBKIT_PATCH_MARKER)) {
    throw new Error(
      `${label}: ${libraryPath} is missing the linuxdeploy-plugin-gtk ` +
        `'${WEBKIT_PATCH_MARKER}' relocation. The plugin was not applied or is unpinned.`,
    );
  }
  if (WEBKIT_UNPATCHED_PATH.test(text)) {
    throw new Error(
      `${label}: ${libraryPath} still contains an unpatched ` +
        `/usr/lib/<triplet>/webkit2gtk-4.1 path.`,
    );
  }
}

export function assertWebKitBundled(squashfsRoot, label) {
  const found = findBundledWebKit(squashfsRoot);
  if (found.libraries.length === 0) {
    throw new Error(
      `${label} is missing libwebkit2gtk-4.1.so. linuxdeploy-plugin-gtk must bundle it; ` +
        'refusing to ship an AppImage that needs a host WebKitGTK.',
    );
  }
  if (found.javascriptcore.length === 0) {
    throw new Error(`${label} is missing libjavascriptcoregtk-4.1.so.`);
  }
  if (found.webProcess.length === 0 || found.networkProcess.length === 0) {
    throw new Error(
      `${label} is missing WebKitWebProcess or WebKitNetworkProcess. ` +
        'Both webview helper binaries must be present and executable.',
    );
  }
  if (found.injectedBundles.length === 0) {
    throw new Error(`${label} is missing injected-bundle/libwebkit2gtkinjectedbundle.so.`);
  }
  if (!found.helperDir) {
    throw new Error(`${label} is missing usr/lib/<triplet>/webkit2gtk-4.1/.`);
  }
  for (const helper of [...found.webProcess, ...found.networkProcess, ...found.injectedBundles]) {
    if (!helper.startsWith(`${found.helperDir}/`)) {
      throw new Error(
        `${label}: ${helper.slice(squashfsRoot.length + 1)} is not inside ` +
          `${found.helperDir.slice(squashfsRoot.length + 1)}.`,
      );
    }
  }
  for (const library of found.libraries) {
    assertWebKitPathPatch(library, label);
  }
  return found;
}

/**
 * Tauri can reuse an existing AppDir. Pruning the source staging directory
 * before a later build therefore does not remove foreign runtimes already
 * copied into usr/lib/<productName>/onnxruntime-libs. Keep only the runtime
 * for the Linux target being packaged; unknown resource directories are left
 * untouched so this cleanup cannot delete a future, unregistered artifact.
 */
export function collectRuntimePrunePlan(runtimeRoot, targetId) {
  if (!existsSync(runtimeRoot)) return { remove: [], keep: [] };

  const remove = [];
  const keep = [];
  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let normalized;
    try {
      normalized = normalizeTargetId(entry.name);
    } catch {
      continue;
    }
    const full = join(runtimeRoot, entry.name);
    if (normalized === targetId) keep.push(full);
    else remove.push(full);
  }
  return { remove, keep };
}

/**
 * Cargo dep-info (and similar) files matched by `bundle.resources` globs such
 * as `varve-generative-helper*`. They are not runtime payloads.
 */
export function collectStrayBuildArtifacts(squashfsRoot) {
  const remove = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (STRAY_BUILD_FILE_NAMES.has(entry.name)) remove.push(full);
    }
  }
  walk(squashfsRoot);
  return remove;
}

function existsAsEntry(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tauri names the AppImage desktop file from `productName` (`Varve.desktop`).
 * AppStream, AUR, and Flatpak use the reverse-DNS id `dev.varve.desktop.desktop`.
 * Rename the payload so the shipped file matches `<launchable>`.
 */
export function normalizeAppImageDesktopEntries(squashfsRoot) {
  const applications = join(squashfsRoot, 'usr', 'share', 'applications');
  const shipped = join(applications, TAURI_APPIMAGE_DESKTOP_NAME);
  const canonical = join(applications, APPSTREAM_DESKTOP_ID);
  if (existsAsEntry(shipped) && shipped !== canonical) {
    if (existsAsEntry(canonical)) rmSync(canonical);
    renameSync(shipped, canonical);
  }

  const topShipped = join(squashfsRoot, TAURI_APPIMAGE_DESKTOP_NAME);
  const topCanonical = join(squashfsRoot, APPSTREAM_DESKTOP_ID);
  if (existsAsEntry(topShipped)) rmSync(topShipped);
  if (existsAsEntry(canonical) && !existsAsEntry(topCanonical)) {
    symlinkSync(join('usr', 'share', 'applications', APPSTREAM_DESKTOP_ID), topCanonical);
  }
}

/**
 * AppImageHub launches with `firejail --appimage`, which kernel-mounts the
 * SquashFS and enforces mode bits. Root-owned 0700 directories and 0770
 * `AppRun.wrapped` then fail with `AppRun: Permission denied`. FUSE mounts
 * hide this. Normalise before linuxdeploy repacks.
 */
export function normalizeAppDirPermissions(squashfsRoot) {
  execFileSync('chmod', ['-R', 'u+rwX,go+rX,go-w', squashfsRoot]);
  for (const file of LAUNCHER_PATHS) {
    const path = join(squashfsRoot, file);
    if (existsSync(path)) chmodSync(path, 0o755);
  }
}

/**
 * GNU and LLVM `readelf -d` both print
 * `(NEEDED)             Shared library: [libfoo.so.0]`.
 * A `NEEDED <token> [name]` pattern never matches that line.
 */
export function parseReadelfNeeded(output) {
  const names = [];
  for (const line of output.split('\n')) {
    const match = line.match(/\(NEEDED\)\s+Shared library:\s+\[([^\]]+)\]/);
    if (match) names.push(match[1]);
  }
  return names;
}

export function listElfNeeded(filePath) {
  const out = execFileSync('readelf', ['-d', filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseReadelfNeeded(out);
}

export function payloadHasSoname(squashfsRoot, soname) {
  const roots = [join(squashfsRoot, 'usr', 'lib'), join(squashfsRoot, 'usr', 'lib64')];
  function walk(dir) {
    if (!existsSync(dir)) return false;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === soname) return true;
      if (entry.isDirectory() && !entry.isSymbolicLink() && walk(join(dir, entry.name))) {
        return true;
      }
    }
    return false;
  }
  return roots.some((dir) => walk(dir));
}

function isElfFile(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const magic = Buffer.alloc(4);
    const bytes = readSync(fd, magic, 0, 4, 0);
    return (
      bytes === 4 &&
      magic[0] === 0x7f &&
      magic[1] === 0x45 &&
      magic[2] === 0x4c &&
      magic[3] === 0x46
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function collectElfFiles(squashfsRoot) {
  const files = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (isElfFile(full)) files.push(full);
    }
  }
  walk(join(squashfsRoot, 'usr', 'bin'));
  walk(join(squashfsRoot, 'usr', 'lib'));
  walk(join(squashfsRoot, 'usr', 'lib64'));
  return files;
}

export function resolveHostLibrary(soname) {
  try {
    const out = execFileSync('ldconfig', ['-p'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      const match = line.match(/^\s*(\S+)\s+\(.*\)\s+=>\s+(\S+)/);
      if (match?.[1] === soname && existsSync(match[2])) return match[2];
    }
  } catch {
    // ldconfig is not required when the fallback paths exist
  }
  for (const dir of [
    '/lib/x86_64-linux-gnu',
    '/usr/lib/x86_64-linux-gnu',
    '/lib/aarch64-linux-gnu',
    '/usr/lib/aarch64-linux-gnu',
    '/lib64',
    '/usr/lib',
    '/lib',
  ]) {
    const candidate = join(dir, soname);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * linuxdeploy's first pass (and `--exclude-library '*'`) can omit GTK/Pango
 * companions such as libfribidi. Copy those from the build host so a clean
 * VM does not fail on `error while loading shared libraries`.
 */
export function copyMissingToolkitLibraries(squashfsRoot) {
  const destDir = join(squashfsRoot, 'usr', 'lib');
  mkdirSync(destDir, { recursive: true });
  const copied = [];
  const neededCache = new Map();
  let changed = true;
  let round = 0;
  for (; changed && round < 12; round += 1) {
    changed = false;
    for (const elf of collectElfFiles(squashfsRoot)) {
      let needed = neededCache.get(elf);
      if (!needed) {
        try {
          needed = listElfNeeded(elf);
        } catch {
          continue;
        }
        neededCache.set(elf, needed);
      }
      for (const soname of needed) {
        if (!shouldCopyMissingDependency(soname) || payloadHasSoname(squashfsRoot, soname)) {
          continue;
        }
        const host = resolveHostLibrary(soname);
        if (!host) {
          throw new Error(
            `${elf.slice(squashfsRoot.length + 1)} needs ${soname}, which is not ` +
              'in the AppDir and not on the build host. Refusing to pack an AppImage ' +
              'that cannot start on a clean system.',
          );
        }
        const real = realpathSync(host);
        const realName = real.split(/[/\\]/).pop();
        copyFileSync(real, join(destDir, realName));
        if (realName !== soname) {
          const link = join(destDir, soname);
          if (existsSync(link)) rmSync(link);
          symlinkSync(realName, link);
        }
        copied.push(soname);
        changed = true;
      }
    }
  }
  const leftover = [];
  for (const elf of collectElfFiles(squashfsRoot)) {
    let needed = neededCache.get(elf);
    if (!needed) {
      try {
        needed = listElfNeeded(elf);
      } catch {
        continue;
      }
    }
    for (const soname of needed) {
      if (shouldCopyMissingDependency(soname) && !payloadHasSoname(squashfsRoot, soname)) {
        leftover.push(`${elf.slice(squashfsRoot.length + 1)} -> ${soname}`);
      }
    }
  }
  if (leftover.length > 0) {
    throw new Error(
      'AppDir still has unresolved toolkit DT_NEEDED entries after copying from the host: ' +
        leftover.join(', '),
    );
  }
  return copied;
}

/** Payload hygiene + modes that every released AppImage must have before pack. */
export function prepareAppDirForRepack(squashfsRoot) {
  const stray = collectStrayBuildArtifacts(squashfsRoot);
  for (const entry of stray) rmSync(entry, { force: true });
  normalizeAppImageDesktopEntries(squashfsRoot);
  normalizeAppDirPermissions(squashfsRoot);
  const { helpers } = findBundledWebKit(squashfsRoot);
  for (const helper of helpers) chmodSync(helper, 0o755);
  return { stray };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = resolve(args['bundle-dir'] ?? 'apps/desktop/src-tauri/target/release/bundle');
  const toolsDir =
    args['tools-dir'] ?? process.env.TAURI_CACHE_DIR ?? join(homedir(), '.cache', 'tauri');
  const architecture = normalizeArchitecture(args.arch ?? process.arch);
  const appImage = findAppImage(bundleDir);
  if (!appImage) {
    process.stdout.write('No AppImage found — nothing to prune.\n');
    return;
  }

  const appImageDir = join(bundleDir, 'appimage');
  const appImagePath = join(appImageDir, appImage);
  const work = mkdtempSync(join(tmpdir(), 'varve-appimage-prune-'));
  const squashfsRoot = join(work, 'squashfs-root');

  process.stdout.write(
    `Preparing AppImage payload (keep WebKit, drop host GPU libs) from ${appImage}...\n`,
  );

  // Extract the AppImage payload. NOTE: the runtime's
  // `--appimage-extract <dir>` form silently creates an empty dir in some
  // versions; the no-arg form extracts to ./squashfs-root reliably.
  execFileSync(appImagePath, ['--appimage-extract'], { cwd: work, stdio: 'pipe' });

  const resourceDirName = resolveLinuxResourceDirName();
  assertWebKitBundled(squashfsRoot, 'Tauri AppImage payload');
  // Keep WebKit/GTK/GStreamer. Remove only host GPU/EGL/Mesa so a clean
  // offline system can launch and a newer host Mesa is not shadowed.
  const { remove, keep } = collectPrunePlan(squashfsRoot, resourceDirName);
  for (const entry of remove) {
    rmSync(entry, { recursive: true, force: true });
  }
  const targetId = targetIdFor('linux', architecture);
  const runtimeRoot = resourceDirName
    ? join(squashfsRoot, 'usr', 'lib', resourceDirName, 'onnxruntime-libs')
    : null;
  const runtimePlan = runtimeRoot
    ? collectRuntimePrunePlan(runtimeRoot, targetId)
    : { remove: [], keep: [] };
  for (const entry of runtimePlan.remove) {
    rmSync(entry, { recursive: true, force: true });
  }
  const copiedDeps = copyMissingToolkitLibraries(squashfsRoot);
  if (copiedDeps.length > 0) {
    process.stdout.write(
      'Copied ' +
        copiedDeps.length +
        ' missing toolkit libraries from the build host: ' +
        copiedDeps.join(', ') +
        '\n',
    );
  }
  if (runtimePlan.remove.length > 0) {
    process.stdout.write(
      'Removing ' +
        runtimePlan.remove.length +
        ' foreign ONNX Runtime target director' +
        (runtimePlan.remove.length === 1 ? 'y' : 'ies') +
        ' from the AppImage payload.\n',
    );
  }
  const removed = remove.length;
  if (keep.length > 0) {
    process.stdout.write(
      `Preserving ${keep.length} resource directory(ies): ${keep
        .map((p) => p.slice(squashfsRoot.length + 1))
        .join(', ')}\n`,
    );
  }

  // Always normalise and repack. The no-prune path used to return the original
  // Tauri AppImage, which ships root-owned 0700 directories and 0770
  // AppRun.wrapped — firejail then fails with "AppRun: Permission denied".
  const { stray } = prepareAppDirForRepack(squashfsRoot);
  if (stray.length > 0) {
    process.stdout.write(
      'Removing ' +
        stray.length +
        ' stray build artifact(s): ' +
        stray.map((p) => relative(squashfsRoot, p)).join(', ') +
        '\n',
    );
  }
  if (removed === 0 && runtimePlan.remove.length === 0) {
    process.stdout.write(
      'No bundled libraries to prune; normalising permissions and re-assembling the AppImage.\n',
    );
  }

  // Re-assemble with linuxdeploy + its AppImage output plugin — the same
  // toolchain Tauri used to build the original. A hand-rolled
  // runtime + mksquashfs concatenation produces an invalid ELF (the runtime
  // reads its squashfs offset from an ELF section, not by scanning for
  // "hsqs" — verified 2026-08-11 with a segfaulting repack). `--exclude-library
  // '*'` keeps linuxdeploy from copying the CI host's Mesa/EGL back into
  // the AppDir after we deleted it. Existing WebKit/GTK files stay.
  const linuxdeploy =
    findTool(
      toolsDir,
      architecture === 'aarch64'
        ? ['linuxdeploy-aarch64.AppImage', 'linuxdeploy.AppImage']
        : ['linuxdeploy-x86_64.AppImage', 'linuxdeploy.AppImage'],
    ) ?? process.env.LINUXDEPLOY;
  if (!linuxdeploy) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(
      `linuxdeploy not found in ${toolsDir}. Pass --tools-dir or set LINUXDEPLOY. ` +
        'Tauri downloads it to ~/.cache/tauri during the build.',
    );
  }
  const pluginAppImage = findTool(toolsDir, [
    `linuxdeploy-plugin-appimage-${architecture}.AppImage`,
    'linuxdeploy-plugin-appimage-x86_64.AppImage',
  ]);
  if (pluginAppImage) {
    process.env.LINUXDEPLOY_PLUGIN_APPIMAGE = pluginAppImage;
  }

  const output = join(appImageDir, appImage);
  rmSync(output, { force: true });
  execFileSync(
    linuxdeploy,
    [
      '--appimage-extract-and-run',
      '--appdir',
      squashfsRoot,
      '--exclude-library',
      '*',
      '--output',
      'appimage',
    ],
    { cwd: work, env: { ...process.env, OUTPUT: output, ARCH: architecture }, stdio: 'inherit' },
  );

  if (!existsSync(output) || statSync(output).size === 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error('linuxdeploy did not produce the pruned AppImage.');
  }
  chmodSync(output, 0o755);

  // Re-assembly is the step that dropped resources in the past, so verify the
  // final payload — not just the intermediate AppDir — still carries them,
  // still has WebKit, and did not re-grow a GPU stack.
  const verifyWork = mkdtempSync(join(tmpdir(), 'varve-appimage-verify-'));
  try {
    execFileSync(output, ['--appimage-extract'], { cwd: verifyWork, stdio: 'pipe' });
    const packedRoot = join(verifyWork, 'squashfs-root');
    assertWebKitBundled(packedRoot, 'Reassembled AppImage');
    const leftoverGpu = collectPrunePlan(packedRoot, resourceDirName);
    if (leftoverGpu.remove.length > 0) {
      throw new Error(
        'Reassembled AppImage still contains host GPU or system-sensitive libraries: ' +
          leftoverGpu.remove.map((p) => p.slice(packedRoot.length + 1)).join(', '),
      );
    }
    if (keep.length > 0 && resourceDirName) {
      const preserved = join(packedRoot, 'usr', 'lib', resourceDirName);
      if (!existsSync(preserved)) {
        throw new Error(
          'Pruned AppImage lost its resource directory usr/lib/' +
            resourceDirName +
            '. The native ONNX Runtime and generative helper would be missing.',
        );
      }
      const finalRuntimeRoot = join(preserved, 'onnxruntime-libs');
      const finalRuntimePlan = collectRuntimePrunePlan(finalRuntimeRoot, targetId);
      if (finalRuntimePlan.remove.length > 0) {
        throw new Error(
          'Pruned AppImage still contains foreign ONNX Runtime targets: ' +
            finalRuntimePlan.remove.map((p) => p.slice(finalRuntimeRoot.length + 1)).join(', '),
        );
      }
    }
  } finally {
    rmSync(verifyWork, { recursive: true, force: true });
  }

  verifyAppImagePermissions(output);

  const prunedSize = statSync(output).size;
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(
    `Removed ${removed} host GPU library entries and ${runtimePlan.remove.length} foreign ` +
      `runtime directories, and re-assembled ${appImage} (${(prunedSize / 1e6).toFixed(1)} MB). ` +
      'AppImage keeps bundled WebKit/GTK and uses host Mesa/EGL — see module doc.\n',
  );
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
