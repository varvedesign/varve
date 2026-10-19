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
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
  /^(?:libEGL(?:_[^.]+)?|libGL(?:U|X(?:_[^.]+)?|ES(?:v1_CM|v2)|dispatch|api)?|libOpenGL|libglapi|libdrm(?:_[^.]+)?|libgbm|libvulkan|libwayland-egl|libnvidia.*|libcuda.*)(?:\.so(?:\..*)?)?$/;

export const HOST_GRAPHICS_DIR_NAMES = new Set(['dri', 'mesa', 'nvidia', 'glvnd']);

export function isHostGraphicsLibraryName(name) {
  return HOST_GRAPHICS_FILE_RE.test(name);
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
      if (isHostGraphicsLibraryName(entry.name)) remove.push(full);
    }
  }

  for (const dirName of ['lib', 'lib64']) {
    walk(join(squashfsRoot, 'usr', dirName));
  }
  return { remove, keep };
}

export function findBundledWebKit(squashfsRoot) {
  const libraries = [];
  const helpers = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(full);
        continue;
      }
      if (/^libwebkit2gtk-4\.1\.so/.test(entry.name)) libraries.push(full);
      if (/^WebKit(?:Web|Network|Storage)Process$/.test(entry.name)) helpers.push(full);
    }
  }
  walk(join(squashfsRoot, 'usr'));
  return { libraries, helpers };
}

export function assertWebKitBundled(squashfsRoot, label) {
  const { libraries, helpers } = findBundledWebKit(squashfsRoot);
  if (libraries.length === 0) {
    throw new Error(
      `${label} is missing libwebkit2gtk-4.1.so. linuxdeploy-plugin-gtk must bundle it; ` +
        'refusing to ship an AppImage that needs a host WebKitGTK.',
    );
  }
  if (helpers.length === 0) {
    throw new Error(
      `${label} is missing WebKitWebProcess / WebKitNetworkProcess. ` +
        'The webview helper binaries must be executable inside the payload.',
    );
  }
  return { libraries, helpers };
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
        'Reassembled AppImage still contains host GPU libraries: ' +
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
