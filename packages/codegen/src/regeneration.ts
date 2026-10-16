/**
 * Regeneration ownership: what a code bundle remembers about itself, and how
 * a re-export must treat files it did not generate or that someone edited.
 *
 * Ownership model (the Plasmic lesson, without their product model):
 * - Every bundle carries a manifest (path → content hash). A file whose
 *   current bytes match the manifest hash is *generator-owned and
 *   unchanged* — safe to update in place.
 * - A file present on disk whose hash does NOT match the manifest was
 *   edited after generation — it is a *conflict*. The planner flags it and
 *   never overwrites it silently; there is deliberately no overwrite-all.
 * - Anything on disk that no manifest claims is *handwritten or foreign* —
 *   untouched by definition. A "generated" comment proves nothing.
 * - Files the previous manifest owned but the new bundle no longer emits
 *   are *stale* — reported so a human can decide; the planner never
 *   deletes.
 */

import { sha256Hex } from '@varve/scene';
import type { GeneratedBundle } from './types';

/** The manifest file written beside every generated bundle. */
export const CODEGEN_MANIFEST_PATH = 'varve-codegen.manifest.json';

export interface CodegenManifest {
  generator: '@varve/codegen';
  manifestVersion: 1;
  target: string;
  /** Source identity: doc revision plus an options fingerprint, so a
   *  consumer can tell "same inputs" from "inputs changed". */
  source: { docRevision?: string; optionsFingerprint: string };
  files: Record<string, { sha256: string; role: 'code' | 'asset' | 'manifest' }>;
  dependencies: Record<string, string>;
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Build the manifest for a bundle. The manifest itself is excluded from its
 * own file map (it is the commitment device, not a generated artifact).
 */
export function buildCodegenManifest(
  bundle: GeneratedBundle,
  source: { docRevision?: string; optionsFingerprint: string },
): CodegenManifest {
  const files: CodegenManifest['files'] = {};
  for (const file of bundle.files) {
    if (file.path === CODEGEN_MANIFEST_PATH) continue;
    files[file.path] = { sha256: sha256Hex(encodeText(file.contents)), role: 'code' };
  }
  for (const asset of bundle.assets ?? []) {
    files[asset.path] = { sha256: asset.sha256, role: 'asset' };
  }
  return {
    generator: '@varve/codegen',
    manifestVersion: 1,
    target: bundle.target,
    source,
    files,
    dependencies: bundle.dependencies,
  };
}

export function serializeManifest(manifest: CodegenManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseManifest(text: string): CodegenManifest | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { generator?: unknown }).generator === '@varve/codegen' &&
      (parsed as { files?: unknown }).files &&
      typeof (parsed as { files: unknown }).files === 'object'
    ) {
      return parsed as CodegenManifest;
    }
    return null;
  } catch {
    return null;
  }
}

/** What the planner proposes for one path already present at the destination. */
export type RegenerationAction =
  /** New output the destination does not have. */
  | 'create'
  /** Generated content, unchanged on disk since the last manifest — safe to replace. */
  | 'update'
  /** Generated content that was edited after generation — flagged, never auto-replaced. */
  | 'conflict'
  /** Present at the destination but owned by nobody — untouched. */
  | 'preserve'
  /** The previous bundle owned it; the new one no longer emits it. Reported, never deleted. */
  | 'stale';

export interface RegenerationEntry {
  path: string;
  action: RegenerationAction;
  /** For conflicts: the hash recorded at generation time (what the file drifted from). */
  expectedSha256?: string;
  /** For conflicts and stale entries: the hash of the destination bytes. */
  currentSha256?: string;
}

export interface RegenerationPlan {
  entries: RegenerationEntry[];
  /** True when at least one generated file was edited since generation. */
  hasConflicts: boolean;
}

/**
 * Compute the regeneration plan against the destination's current bytes.
 *
 * `destination` maps relative paths to current file contents (string or
 * bytes); missing keys mean the file does not exist. The planner reads — it
 * never writes — and the result is a proposal a caller must present before
 * touching anything.
 */
export function planRegeneration(
  destination: Record<string, string | Uint8Array>,
  previousManifest: CodegenManifest | null,
  nextBundle: GeneratedBundle,
): RegenerationPlan {
  const hashOf = (value: string | Uint8Array): string =>
    typeof value === 'string' ? sha256Hex(encodeText(value)) : sha256Hex(value);

  const entries: RegenerationEntry[] = [];
  const nextPaths = new Set<string>();
  for (const file of nextBundle.files) {
    if (file.path === CODEGEN_MANIFEST_PATH) continue;
    nextPaths.add(file.path);
    entries.push({ path: file.path, action: 'create' });
  }
  for (const asset of nextBundle.assets ?? []) {
    nextPaths.add(asset.path);
    entries.push({ path: asset.path, action: 'create' });
  }

  const claimedPaths = new Set<string>();
  if (previousManifest) {
    for (const [path, record] of Object.entries(previousManifest.files)) {
      claimedPaths.add(path);
      const current = destination[path];
      if (current === undefined) continue; // deleted by hand; the new output recreates or not
      const currentSha = hashOf(current);
      if (nextPaths.has(path)) {
        const entry = entries.find((e) => e.path === path);
        if (!entry) continue;
        if (currentSha === record.sha256) {
          entry.action = 'update';
        } else {
          entry.action = 'conflict';
          entry.expectedSha256 = record.sha256;
          entry.currentSha256 = currentSha;
        }
      } else if (currentSha === record.sha256) {
        entries.push({
          path,
          action: 'stale',
          expectedSha256: record.sha256,
          currentSha256: currentSha,
        });
      } else {
        // Claimed once, edited since, no longer emitted: a human edited a
        // generated file AND the generator moved on. Preserve and surface.
        entries.push({
          path,
          action: 'conflict',
          expectedSha256: record.sha256,
          currentSha256: currentSha,
        });
      }
    }
  }

  for (const path of Object.keys(destination)) {
    if (nextPaths.has(path) || claimedPaths.has(path)) continue;
    entries.push({ path, action: 'preserve' });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, hasConflicts: entries.some((e) => e.action === 'conflict') };
}

/** Attach the manifest as the bundle's final file (the commit point of a regeneration). */
export function withRegenerationManifest(
  bundle: GeneratedBundle,
  source: { docRevision?: string; optionsFingerprint: string },
): GeneratedBundle {
  const manifest = buildCodegenManifest(bundle, source);
  const manifestFile = {
    path: CODEGEN_MANIFEST_PATH,
    language: 'json' as const,
    mimeType: 'application/json',
    contents: serializeManifest(manifest),
    entry: false,
  };
  return {
    ...bundle,
    files: [...bundle.files.filter((f) => f.path !== CODEGEN_MANIFEST_PATH), manifestFile],
  };
}
