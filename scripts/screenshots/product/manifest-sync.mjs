/**
 * Manifest sync: reviewed-capture promotion and normalize metadata
 * re-derivation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { reviewedAssemblyMetadata, sourceSceneProvenance } from '../capture-safety.mjs';
import { analyseImage } from '../lib/image-analysis.mjs';
import { SOURCE_SCENES } from '../source-scenes.mjs';
import {
  CANONICAL_DIR,
  MANIFEST_PATH,
  OUT_DIR,
  OUTPUT_DIRS,
  OUTPUT_MANIFEST,
  onlyScenes,
  PUBLIC_DIR,
  reviewDir,
} from './config.mjs';
import {
  computeSourceIdentity,
  manifestDigestAtStart,
  playwrightVersion,
  sha256Hex,
  writeFileAtomicSync,
} from './provenance.mjs';
import { freshSourceSceneCapture, SCENES, sourceScenePath } from './scenes/index.mjs';
import { failures, manifest, recordFailure, runId, sourceIdentity } from './state.mjs';
import { openVariantSupport } from './variants.mjs';

export function syncReviewedPromotion() {
  if (!reviewDir || onlyScenes.size === 0) {
    throw new Error('--sync-reviewed requires --review-dir and explicit --scenes');
  }
  const reviewedBytes = readFileSync(OUTPUT_MANIFEST);
  const reviewed = JSON.parse(reviewedBytes.toString('utf8'));
  // The review manifest records the published manifest it was reviewed
  // against. If the published manifest changed since (another capture run, a
  // concurrent agent), promoting now would silently drop that work.
  const reviewedAgainst = reviewed.reviewedAgainst;
  const currentBytes = readFileSync(MANIFEST_PATH);
  if (reviewedAgainst && sha256Hex(currentBytes) !== reviewedAgainst) {
    throw new Error(
      'Published manifest changed since this review was captured — re-run the review before syncing',
    );
  }
  const current = JSON.parse(currentBytes.toString('utf8'));
  const approved = [...onlyScenes].map((id) => {
    const entry = reviewed.scenes[id];
    if (entry?.status !== 'captured' || basename(entry.file) !== entry.file) {
      throw new Error(`No successful reviewed capture for ${id}`);
    }
    const bytes = readFileSync(join(OUT_DIR, entry.file));
    // Tamper check: the reviewed bytes must still hash to what the review
    // recorded. A modified review file is refused, not promoted.
    if (sha256Hex(bytes) !== entry.sha256) {
      throw new Error(`Reviewed capture changed after capture: ${id}`);
    }
    const analysis = analyseImage(bytes);
    if (!analysis.valid) {
      throw new Error(`Reviewed capture for ${id} does not decode: ${analysis.errors.join('; ')}`);
    }
    return { id, entry, bytes };
  });
  for (const { id, entry, bytes } of approved) {
    // Files first, then the manifest: a build reading the manifest never finds
    // a name whose bytes are not on disk yet.
    writeFileAtomicSync(join(CANONICAL_DIR, entry.file), bytes);
    writeFileAtomicSync(join(PUBLIC_DIR, entry.file), bytes);
    current.scenes[id] = {
      ...entry,
      provenance: {
        ...(entry.provenance ?? {}),
        promotedFrom: reviewed.provenance?.runId ?? 'unknown-review-run',
        promotedAt: new Date().toISOString(),
      },
    };
  }
  current.generatedAt = new Date().toISOString();
  Object.assign(
    current,
    reviewedAssemblyMetadata({
      scenes: current.scenes,
      sourceIdentity: computeSourceIdentity(),
      assembledAt: current.generatedAt,
      reviewSha256: sha256Hex(reviewedBytes),
      reviewedAgainst: sha256Hex(currentBytes),
      promotedSceneIDs: [...onlyScenes],
    }),
  );
  writeFileAtomicSync(MANIFEST_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Synced ${approved.length} reviewed captures; other scenes preserved.`);
  process.exit(0);
}

/**
 * A cropped scene's `kind` is derived from the capture geometry it actually
 * asked for, not from a style attribute at the consumer. `panel` is a tall
 * narrow column, `wide` is a short full-width strip, everything else cropped
 * is a `detail`, and an uncropped scene is a `full` frame. The website uses
 * this to pick a fit policy, so a new panel crop is never forced through a
 * landscape `cover` window (which silently cropped the layer rows away).
 */
export function sceneKind(scene) {
  if (scene.kind) return scene.kind;
  if (!scene.clip) return 'full';
  // A panel is a narrow column (the inspector / layers sidebar) whether it is
  // a 380px-tall slice or a full-height stack; `wide` is a short full-width
  // strip (the timeline). Everything else cropped is a detail.
  if (scene.clip.width <= 360) return 'panel';
  if (scene.clip.width >= 1200 && scene.clip.height <= 320) return 'wide';
  return 'detail';
}

/**
 * Kind for an externally-produced scene (a plugin or tonal capture, say) whose
 * capture geometry this script does not own. Derived from the measured size of
 * the file that is actually published — a measurement, not a guess.
 */
export function kindFromGeometry(width, height) {
  if (height <= 320) return 'wide';
  if (width <= 360) return 'panel';
  if (width >= 1024 && height >= 600) return 'full';
  return 'detail';
}

/**
 * `--normalize`: re-derive the manifest's *measurable* metadata from the files
 * that are already published, without recapturing a single pixel.
 *
 * Why this exists: several scenes' screenshots were captured before the
 * manifest recorded `kind`/`crop`/`viewport`, and recapturing all 32 scenes to
 * add a metadata field would needlessly churn committed binaries (and would
 * overwrite a capture another agent is actively iterating on). Dependency-aware
 * freshness says an unchanged screenshot should not be re-shot for a metadata
 * change.
 *
 * What it will and will not write:
 *   - writes: dimensions, hashes and geometry *measured from the real files*,
 *     plus this run's provenance block;
 *   - refuses: `capturedAt` and `lastValidatedAgainst` for scenes this run did
 *     not capture, and instead marks them `provenanceUnknown: true` so a
 *     legacy record is honest rather than backfilled with a guessed revision.
 */
export async function normalizeManifest() {
  let changed = 0;
  for (const scene of SCENES) {
    if (onlyScenes.size > 0 && !onlyScenes.has(scene.id)) continue;
    const entry = manifest.scenes[scene.id] ?? {};
    const publishedPath = join(PUBLIC_DIR, scene.file);
    if (!existsSync(publishedPath)) {
      if (entry.status === 'captured' || Object.keys(entry).length > 0) {
        console.error(`FAIL ${scene.id}: no published capture at ${scene.file}`);
        recordFailure();
      }
      continue;
    }
    const bytes = readFileSync(publishedPath);
    const analysis = analyseImage(bytes);
    if (!analysis.valid) {
      console.error(
        `FAIL ${scene.id}: ${scene.file} does not decode: ${analysis.errors.join('; ')}`,
      );
      recordFailure();
      continue;
    }
    const recordedHash = sha256Hex(bytes);
    const wasCaptured = entry.status === 'captured';
    if (wasCaptured && entry.sha256 && entry.sha256 !== recordedHash) {
      // The file on disk is not the file the manifest describes: normalising
      // would launder an edited asset into a trusted record.
      console.error(`FAIL ${scene.id}: ${scene.file} does not match its recorded sha256`);
      recordFailure();
      continue;
    }
    const next = {
      ...entry,
      file: scene.file,
      alt: scene.alt,
      caption: scene.caption,
      feature: scene.feature,
      theme: scene.theme,
      kind: sceneKind(scene),
      width: analysis.width,
      height: analysis.height,
      status: 'captured',
      reason: undefined,
      sha256: recordedHash,
      crop: scene.clip ? { ...scene.clip } : undefined,
      viewport:
        scene.viewport && (scene.viewport.width !== 1440 || scene.viewport.height !== 900)
          ? { ...scene.viewport }
          : undefined,
      scale: 1,
    };
    if (!entry.capturedAt && !entry.lastValidatedAgainst) next.provenanceUnknown = true;
    if (JSON.stringify(next) !== JSON.stringify(entry)) changed++;
    manifest.scenes[scene.id] = next;
  }

  const variantSupport = await openVariantSupport();
  try {
    for (const [id, entry] of Object.entries(manifest.scenes)) {
      if (onlyScenes.size > 0 && !onlyScenes.has(id)) continue;
      if (entry.status !== 'captured' || !entry.file) continue;
      const pngPath = join(reviewDir ? OUT_DIR : PUBLIC_DIR, entry.file);
      if (!existsSync(pngPath)) continue;
      const nextVariants = await variantSupport.writeSceneVariants(
        entry,
        readFileSync(pngPath),
        reviewDir ? [OUT_DIR] : OUTPUT_DIRS,
      );
      if (!nextVariants) continue;
      entry.variants = nextVariants;
      changed++;
    }
  } finally {
    await variantSupport.close();
  }
  // Externally-produced scenes (plugin, tonal, comic) are not in SCENES, so
  // they never pass through `sceneKind`. Derive their kind from the measured
  // size of the published file so the website has a fit policy for every
  // captured scene rather than only for the ones this script captures.
  for (const [id, entry] of Object.entries(manifest.scenes)) {
    if (entry.status !== 'captured' || entry.kind || !entry.width || !entry.height) continue;
    manifest.scenes[id] = { ...entry, kind: kindFromGeometry(entry.width, entry.height) };
    changed++;
  }
  for (const source of SOURCE_SCENES) {
    if (onlyScenes.size > 0 && !onlyScenes.has(source.id)) continue;
    const capturePath = sourceScenePath(source);
    if (!existsSync(capturePath)) {
      console.error(`FAIL source scene ${source.id}: no producer capture at ${capturePath}`);
      recordFailure();
      continue;
    }
    const bytes = readFileSync(capturePath);
    const analysis = analyseImage(bytes);
    if (!analysis.valid) {
      console.error(`FAIL source scene ${source.id}: ${source.file} does not decode`);
      recordFailure();
      continue;
    }
    if (reviewDir) {
      writeFileAtomicSync(join(OUT_DIR, source.file), bytes);
    } else {
      writeFileAtomicSync(join(CANONICAL_DIR, source.file), bytes);
    }
    const previous = manifest.scenes[source.id] ?? {};
    const sourceHash = sha256Hex(bytes);
    const provenance = sourceSceneProvenance(
      previous,
      sourceHash,
      freshSourceSceneCapture(source, capturePath),
    );
    manifest.scenes[source.id] = {
      ...previous,
      file: source.file,
      alt: source.alt,
      caption: source.caption,
      feature: source.feature,
      theme: source.theme,
      kind: source.kind,
      width: analysis.width,
      height: analysis.height,
      status: 'captured',
      reason: undefined,
      sha256: sourceHash,
      source: source.producer,
      // The measured frame, so the geometry check holds for a capture whose
      // frame differs from the 1440x900 default (a phone-sized or taller one).
      viewport: source.viewport ? { ...source.viewport } : undefined,
      ...provenance,
    };
  }
  const nowBytes = readFileSync(MANIFEST_PATH);
  if (sha256Hex(nowBytes) !== manifestDigestAtStart) {
    console.error('FAIL the manifest changed while normalising — refusing to overwrite it');
    process.exit(1);
  }
  manifest.schemaVersion = 2;
  manifest.generatedAt = new Date().toISOString();
  manifest.provenance = {
    runId,
    runtime: 'metadata-only (--normalize; no capture)',
    captureTool: `playwright ${playwrightVersion()}`,
    sourceRevision: sourceIdentity.sourceRevision,
    sourceDirty: sourceIdentity.sourceDirty,
    sourceDigest: sourceIdentity.sourceDigest,
  };
  manifest.sourceRevision = sourceIdentity.sourceRevision;
  manifest.sourceDigest = sourceIdentity.sourceDigest;
  manifest.captureTool = manifest.provenance.captureTool;
  if (reviewDir) manifest.reviewedAgainst = manifestDigestAtStart;
  writeFileAtomicSync(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `normalised manifest: ${changed} scene record(s) updated, ${failures} failure(s) → ${OUTPUT_MANIFEST}`,
  );
  process.exit(failures > 0 ? 1 : 0);
}
