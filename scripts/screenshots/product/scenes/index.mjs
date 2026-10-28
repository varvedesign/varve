/**
 * Scene-data aggregation plus source-scene (E2E producer) resolution.
 */
import { existsSync, globSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { readProducerCaptureReceipt } from '../../producer-capture.mjs';
import { SOURCE_SCENES } from '../../source-scenes.mjs';
import { args, onlyScenes, PUBLIC_DIR, ROOT, reviewDir, sourceScenesDir } from '../config.mjs';
import { EFFECT_SCENES } from './effects.mjs';
import { FEATURE_SCENES } from './features.mjs';
import { FOUNDATION_SCENES } from './foundations.mjs';
import { TYPE_AND_COLOR_SCENES } from './type-and-color.mjs';

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

export const SCENES = [
  ...FOUNDATION_SCENES,
  ...TYPE_AND_COLOR_SCENES,
  ...EFFECT_SCENES,
  ...FEATURE_SCENES,
];

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

/**
 * E2E-produced scenes: real captures of the running app whose producer is a
 * Playwright spec rather than this script. They are listed here so the
 * manifest stays generated and complete instead of relying on a hardcoded
 * path in a page plus an unmanaged file in `public/screenshots/`.
 *
 * These are normally *inputs*: this script verifies and registers the bytes
 * committed under public/screenshots. `--source-scenes-dir` is the reviewed
 * import path for a new owning-spec capture under test-results/.
 */

export function assertSourceScenesFlags() {
  if (sourceScenesDir) {
    const testResultsRoot = `${resolve(ROOT, 'test-results')}${sep}`;
    if (
      !reviewDir ||
      onlyScenes.size === 0 ||
      !args.includes('--normalize') ||
      !sourceScenesDir.startsWith(testResultsRoot) ||
      !existsSync(sourceScenesDir) ||
      !statSync(sourceScenesDir).isDirectory()
    ) {
      throw new Error(
        '--source-scenes-dir requires --normalize, --review-dir, explicit --scenes, and a directory under test-results/',
      );
    }
    const sourceIds = new Set(SOURCE_SCENES.map((scene) => scene.id));
    if ([...onlyScenes].some((id) => !sourceIds.has(id))) {
      throw new Error(
        '--source-scenes-dir can only import explicitly selected E2E-produced scenes',
      );
    }
    if (SOURCE_SCENES.some((scene) => onlyScenes.has(scene.id) && !scene.captureFile)) {
      throw new Error('each imported E2E scene must declare its producer captureFile');
    }
  }
}

export function sourceScenePath(source) {
  if (!sourceScenesDir) return join(PUBLIC_DIR, source.file);
  const matches = globSync(`**/${source.captureFile}`, { cwd: sourceScenesDir, nodir: true });
  if (matches.length !== 1) {
    throw new Error(
      `${source.id}: expected exactly one ${source.captureFile} under ${sourceScenesDir}, found ${matches.length}`,
    );
  }
  return join(sourceScenesDir, matches[0]);
}

export function freshSourceSceneCapture(source, capturePath) {
  if (!sourceScenesDir) return undefined;
  return readProducerCaptureReceipt(capturePath, source);
}
