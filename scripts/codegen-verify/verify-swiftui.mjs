#!/usr/bin/env node
/**
 * Native-toolchain verification gates for the Flutter and SwiftUI targets.
 *
 * These scripts never fake a pass. Without the SDK installed the result is
 * an explicit UNVERIFIED gate (exit code 2, distinct from pass and fail) —
 * the generated Dart/Swift code has NOT been analyzed, compiled, or run by
 * any toolchain, and no doc may claim otherwise. Generic Node-side parsing
 * does not establish Flutter/SwiftUI correctness.
 *
 * Usage:
 *   node scripts/codegen-verify/verify-flutter.mjs <bundle-dir>
 *   node scripts/codegen-verify/verify-swiftui.mjs <bundle-dir>
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const target = 'swiftui';
const bundleDir = resolve(process.argv[2] ?? process.env.VARVE_CODEGEN_VERIFY_BUNDLE ?? '');

if (!bundleDir || !existsSync(bundleDir)) {
  console.error(`verify-${target}: bundle directory required`);
  process.exit(1);
}

function probe(cmd, args, marker) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return result.status === 0 || out.includes(marker) ? out.trim().split('\n')[0] : null;
}

if (target === 'flutter') {
  const version = probe('flutter', ['--version', '--machine'], 'Flutter');
  if (!version) {
    console.log(
      'verify-flutter: UNVERIFIED — the Flutter SDK is not installed on this machine. ' +
        'The generated Dart has not been analyzed, compiled, or executed. ' +
        'Install Flutter and rerun: flutter analyze && flutter test against a consumer project.',
    );
    process.exit(2);
  }
  const dartFiles = readdirSync(bundleDir).filter((f) => f.endsWith('.dart'));
  if (dartFiles.length === 0) {
    console.error('verify-flutter: no .dart files in the bundle');
    process.exit(1);
  }
  console.error(
    'verify-flutter: SDK present but the consumer-project scaffold (pubspec, widget/golden tests) is not wired yet. ' +
      'EMITTED only — nothing is claimed beyond that.',
  );
  process.exit(2);
}

const swiftProbe = probe('xcodebuild', ['-version'], 'Xcode');
if (!swiftProbe) {
  console.log(
    'verify-swiftui: UNVERIFIED — Xcode/xcodebuild is not available on this machine (SwiftUI builds require Apple SDKs). ' +
      'The generated Swift has not been compiled against SwiftUI. ' +
      'On macOS, build a real consumer project with the exact exported files and rerun.',
  );
  process.exit(2);
}

const swiftFiles = readdirSync(bundleDir).filter((f) => f.endsWith('.swift'));
if (swiftFiles.length === 0) {
  console.error('verify-swiftui: no .swift files in the bundle');
  process.exit(1);
}
console.error(
  'verify-swiftui: Xcode present but the consumer-project scaffold (Xcodeproj/package host, previews/tests) is not wired yet. ' +
    'EMITTED only — nothing is claimed beyond that.',
);
process.exit(2);
