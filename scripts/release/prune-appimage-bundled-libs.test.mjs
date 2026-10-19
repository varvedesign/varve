#!/usr/bin/env node
/**
 * Regression tests for the AppImage payload plan.
 *
 * Context: v0.2.1 dropped ONNX Runtime by deleting all of `usr/lib`.
 * v0.5.1 then dropped WebKit so AppImageHub could not launch on a clean VM.
 * The plan must keep `usr/lib/<productName>` and libwebkit2gtk-4.1, and
 * remove only host GPU/EGL/Mesa libraries.
 */
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  APPSTREAM_DESKTOP_ID,
  collectPrunePlan,
  collectRuntimePrunePlan,
  collectStrayBuildArtifacts,
  findBundledWebKit,
  isHostGraphicsLibraryName,
  normalizeAppDirPermissions,
  normalizeAppImageDesktopEntries,
  prepareAppDirForRepack,
  resolveLinuxResourceDirName,
  TAURI_APPIMAGE_DESKTOP_NAME,
} from './prune-appimage-bundled-libs.mjs';

const root = resolve(import.meta.dirname, '../..');
const fixture = mkdtempSync(join(tmpdir(), 'varve-prune-plan-'));

function write(path, contents = 'x') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function relative(squashfsRoot, path) {
  return path.slice(squashfsRoot.length + 1).replaceAll('\\', '/');
}

function existsAsEntry(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

try {
  assert.equal(isHostGraphicsLibraryName('libEGL.so.1'), true);
  assert.equal(isHostGraphicsLibraryName('libGL.so.1'), true);
  assert.equal(isHostGraphicsLibraryName('libGLdispatch.so.0'), true);
  assert.equal(isHostGraphicsLibraryName('libEGL_mesa.so.0'), true);
  assert.equal(isHostGraphicsLibraryName('libGLX_mesa.so.0'), true);
  assert.equal(isHostGraphicsLibraryName('libGLX_nvidia.so.0'), true);
  assert.equal(isHostGraphicsLibraryName('libdrm.so.2'), true);
  assert.equal(isHostGraphicsLibraryName('libgbm.so.1'), true);
  assert.equal(isHostGraphicsLibraryName('libwayland-egl.so.1'), true);
  assert.equal(isHostGraphicsLibraryName('libwebkit2gtk-4.1.so.0'), false);
  assert.equal(isHostGraphicsLibraryName('libgtk-3.so.0'), false);
  assert.equal(isHostGraphicsLibraryName('libglib-2.0.so.0'), false);
  assert.equal(isHostGraphicsLibraryName('libjavascriptcoregtk-4.1.so.0'), false);

  // ── 1. Resource directory and WebKit survive; GPU libs are removed ──────
  const appRoot = join(fixture, 'appdir');
  write(join(appRoot, 'usr', 'bin', 'varve-desktop'));
  write(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'libwebkit2gtk-4.1.so.0'));
  write(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'webkit2gtk-4.1', 'WebKitWebProcess'));
  write(
    join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'gtk-3.0', 'modules', 'libprintbackend.so'),
  );
  write(join(appRoot, 'usr', 'lib', 'libgtk-3.so.0'));
  write(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'libEGL.so.1'));
  write(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'dri', 'radeonsi_dri.so'));
  write(
    join(appRoot, 'usr', 'lib', 'Varve', 'onnxruntime-libs', 'linux-aarch64', 'libonnxruntime.so'),
  );
  write(join(appRoot, 'usr', 'lib64', 'lib64leftover.so'));
  write(join(appRoot, 'usr', 'lib64', 'libGL.so.1'));

  const plan = collectPrunePlan(appRoot, 'Varve');
  assert.deepEqual(
    plan.keep.map((p) => relative(appRoot, p)),
    ['usr/lib/Varve'],
    'the product resource directory must be kept as a unit',
  );
  assert.deepEqual(
    plan.remove.map((p) => relative(appRoot, p)).sort(),
    [
      'usr/lib/aarch64-linux-gnu/dri',
      'usr/lib/aarch64-linux-gnu/libEGL.so.1',
      'usr/lib64/libGL.so.1',
    ].sort(),
    'only host GPU libraries and DRI drivers must be selected for removal',
  );

  for (const entry of plan.remove) rmSync(entry, { recursive: true, force: true });
  assert.ok(
    existsSync(
      join(
        appRoot,
        'usr',
        'lib',
        'Varve',
        'onnxruntime-libs',
        'linux-aarch64',
        'libonnxruntime.so',
      ),
    ),
    'the bundled ONNX Runtime must survive pruning',
  );
  assert.ok(
    existsSync(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'libwebkit2gtk-4.1.so.0')),
    'libwebkit2gtk-4.1 must stay in the payload',
  );
  assert.ok(
    existsSync(join(appRoot, 'usr', 'lib', 'libgtk-3.so.0')),
    'GTK must stay in the payload',
  );
  assert.ok(
    !existsSync(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'libEGL.so.1')),
    'bundled libEGL must go',
  );
  assert.ok(
    !existsSync(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'dri')),
    'Mesa DRI drivers must go',
  );
  assert.ok(existsSync(join(appRoot, 'usr', 'lib64', 'lib64leftover.so')), 'unrelated lib64 stays');

  const bundled = findBundledWebKit(appRoot);
  assert.equal(bundled.libraries.length, 1);
  assert.equal(bundled.helpers.length, 1);

  // ── 2. Missing resource directory: WebKit stays, GPU still goes ────────
  const bareRoot = join(fixture, 'bare');
  write(join(bareRoot, 'usr', 'lib', 'x86_64-linux-gnu', 'libwebkit2gtk-4.1.so.0'));
  write(join(bareRoot, 'usr', 'lib', 'x86_64-linux-gnu', 'libEGL.so.1'));
  const barePlan = collectPrunePlan(bareRoot, 'Varve');
  assert.equal(barePlan.keep.length, 0, 'no resource directory means nothing is kept as a unit');
  assert.deepEqual(
    barePlan.remove.map((p) => relative(bareRoot, p)),
    ['usr/lib/x86_64-linux-gnu/libEGL.so.1'],
  );
  assert.ok(
    !barePlan.remove.includes(join(bareRoot, 'usr', 'lib', 'Varve')),
    'a non-existent resource directory is never part of the plan',
  );

  // ── 3. Missing usr/lib trees are tolerated ───────────────────────────────
  const emptyRoot = join(fixture, 'empty');
  mkdirSync(emptyRoot, { recursive: true });
  assert.deepEqual(collectPrunePlan(emptyRoot, 'Varve'), { remove: [], keep: [] });

  // ── 4. Reused AppDirs keep only the target runtime ─────────────────────
  const runtimeRoot = join(appRoot, 'usr', 'lib', 'Varve', 'onnxruntime-libs');
  write(join(runtimeRoot, 'linux-x86_64', 'libonnxruntime.so'));
  write(join(runtimeRoot, 'macos-aarch64', 'libonnxruntime.dylib'));
  write(join(runtimeRoot, 'windows-x86_64', 'onnxruntime.dll'));
  write(join(runtimeRoot, 'future-target', 'runtime.bin'));
  const runtimePlan = collectRuntimePrunePlan(runtimeRoot, 'linux-x86_64');
  assert.deepEqual(
    runtimePlan.keep.map((p) => relative(appRoot, p)),
    ['usr/lib/Varve/onnxruntime-libs/linux-x86_64'],
    'the current Linux runtime must survive an AppDir cleanup',
  );
  assert.deepEqual(
    runtimePlan.remove.map((p) => relative(appRoot, p)).sort(),
    [
      'usr/lib/Varve/onnxruntime-libs/linux-aarch64',
      'usr/lib/Varve/onnxruntime-libs/macos-aarch64',
      'usr/lib/Varve/onnxruntime-libs/windows-x86_64',
    ],
    'known foreign runtimes must be removed while unknown directories are preserved',
  );

  // ── 5. Resource directory name comes from the real Tauri config ─────────
  const productName = resolveLinuxResourceDirName(
    join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'),
  );
  assert.equal(
    productName,
    'Varve',
    'tauri.conf.json productName must match the deb resource path',
  );
  assert.equal(resolveLinuxResourceDirName(join(fixture, 'missing', 'tauri.conf.json')), null);

  const confFixture = join(fixture, 'conf', 'tauri.conf.json');
  write(confFixture, JSON.stringify({ productName: 'FixtureApp' }));
  assert.equal(resolveLinuxResourceDirName(confFixture), 'FixtureApp');
  write(confFixture, JSON.stringify({ productName: '' }));
  assert.equal(resolveLinuxResourceDirName(confFixture), null);

  // ── 6. Cargo dep-info files are stripped from the payload ────────────
  const helperD = join(
    appRoot,
    'usr',
    'lib',
    'Varve',
    '_up_',
    '_up_',
    '_up_',
    'target',
    'release',
    'varve-generative-helper.d',
  );
  write(helperD, 'cargo dep-info');
  write(join(appRoot, 'usr', 'lib', 'Varve', 'varve-generative-helper'), 'binary');
  assert.deepEqual(collectStrayBuildArtifacts(appRoot), [helperD]);

  // ── 7. AppDir modes become world-traversable / world-executable ──────
  const modeRoot = join(fixture, 'modes');
  mkdirSync(join(modeRoot, 'usr', 'bin'), { recursive: true });
  writeFileSync(join(modeRoot, 'AppRun'), '#!/bin/sh\n');
  writeFileSync(join(modeRoot, 'AppRun.wrapped'), 'ELF');
  writeFileSync(join(modeRoot, 'usr', 'bin', 'varve-desktop'), 'ELF');
  chmodSync(modeRoot, 0o700);
  chmodSync(join(modeRoot, 'usr'), 0o700);
  chmodSync(join(modeRoot, 'usr', 'bin'), 0o700);
  chmodSync(join(modeRoot, 'AppRun.wrapped'), 0o770);
  chmodSync(join(modeRoot, 'AppRun'), 0o770);
  chmodSync(join(modeRoot, 'usr', 'bin', 'varve-desktop'), 0o770);
  normalizeAppDirPermissions(modeRoot);
  assert.equal(lstatSync(modeRoot).mode & 0o777, 0o755);
  assert.equal(lstatSync(join(modeRoot, 'usr')).mode & 0o777, 0o755);
  assert.equal(lstatSync(join(modeRoot, 'AppRun.wrapped')).mode & 0o777, 0o755);
  assert.equal(lstatSync(join(modeRoot, 'usr', 'bin', 'varve-desktop')).mode & 0o777, 0o755);

  // ── 8. AppImage desktop file matches the AppStream launchable ────────
  const desktopRoot = join(fixture, 'desktop');
  mkdirSync(join(desktopRoot, 'usr', 'share', 'applications'), { recursive: true });
  write(
    join(desktopRoot, 'usr', 'share', 'applications', TAURI_APPIMAGE_DESKTOP_NAME),
    '[Desktop Entry]\nName=Varve\n',
  );
  symlinkSync(
    join('usr', 'share', 'applications', TAURI_APPIMAGE_DESKTOP_NAME),
    join(desktopRoot, TAURI_APPIMAGE_DESKTOP_NAME),
  );
  normalizeAppImageDesktopEntries(desktopRoot);
  assert.ok(
    existsSync(join(desktopRoot, 'usr', 'share', 'applications', APPSTREAM_DESKTOP_ID)),
    'applications desktop must use the reverse-DNS AppStream id',
  );
  assert.ok(
    !existsAsEntry(join(desktopRoot, 'usr', 'share', 'applications', TAURI_APPIMAGE_DESKTOP_NAME)),
    'Tauri productName desktop file must be renamed away',
  );
  assert.equal(
    lstatSync(join(desktopRoot, APPSTREAM_DESKTOP_ID)).isSymbolicLink(),
    true,
    'top-level desktop entry must stay a symlink after the rename',
  );

  const prepared = join(fixture, 'prepared');
  write(
    join(
      prepared,
      'usr',
      'lib',
      'Varve',
      '_up_',
      '_up_',
      '_up_',
      'target',
      'release',
      'varve-generative-helper.d',
    ),
    'dep',
  );
  write(join(prepared, 'AppRun'), '#!/bin/sh\n');
  prepareAppDirForRepack(prepared);
  assert.ok(
    !existsSync(
      join(
        prepared,
        'usr',
        'lib',
        'Varve',
        '_up_',
        '_up_',
        '_up_',
        'target',
        'release',
        'varve-generative-helper.d',
      ),
    ),
    'prepareAppDirForRepack must drop the cargo dep-info file',
  );

  console.log('prune-appimage-bundled-libs tests passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
