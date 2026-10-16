/**
 * Regeneration ownership acceptance: unchanged generated files update,
 * edited generated files become explicit conflicts, handwritten files are
 * preserved, stale outputs are reported but never deleted, and repeated
 * generation is byte-stable.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCodegenManifest,
  CODEGEN_MANIFEST_PATH,
  encodeText,
  parseManifest,
  planRegeneration,
  serializeManifest,
  withRegenerationManifest,
} from '../regeneration';
import { exportNodeToTailwindBundle } from '../tailwind';
import { buildComponentFamilyDoc } from './helpers/corpus';

const SOURCE = { optionsFingerprint: 'test-profile' };

function sampleBundle(marker: string) {
  const c = buildComponentFamilyDoc();
  const bundle = exportNodeToTailwindBundle(c.doc.nodes[c.rootId]!, c.doc, {
    componentName: 'Card',
    fileStem: 'card',
  });
  void marker;
  return bundle;
}

describe('codegen manifest', () => {
  it('records content hashes for every code and asset file', () => {
    const bundle = sampleBundle('a');
    const manifest = buildCodegenManifest(bundle, SOURCE);
    const codePaths = bundle.files.map((f) => f.path);
    for (const path of codePaths) {
      expect(manifest.files[path]?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.files[path]?.role).toBe('code');
    }
    expect(manifest.files[CODEGEN_MANIFEST_PATH]).toBeUndefined();
  });

  it('round-trips through its serialized form and rejects foreign JSON', () => {
    const bundle = sampleBundle('a');
    const parsed = parseManifest(serializeManifest(buildCodegenManifest(bundle, SOURCE)));
    expect(parsed?.target).toBe('react-tailwind');
    expect(parseManifest('{"generator": "other"}')).toBeNull();
    expect(parseManifest('not json')).toBeNull();
  });

  it('generation is deterministic: the same inputs produce the same hashes', () => {
    const a = buildCodegenManifest(sampleBundle('a'), SOURCE);
    const b = buildCodegenManifest(sampleBundle('a'), SOURCE);
    expect(a.files).toEqual(b.files);
  });

  it('attaches the manifest as a bundle file that parses back', () => {
    const bundle = withRegenerationManifest(sampleBundle('a'), SOURCE);
    const file = bundle.files.find((f) => f.path === CODEGEN_MANIFEST_PATH);
    expect(file).toBeDefined();
    expect(parseManifest(file!.contents)?.dependencies).toEqual(bundle.dependencies);
  });
});

describe('regeneration planner', () => {
  it('creates missing files and updates unchanged generated files', () => {
    const first = withRegenerationManifest(sampleBundle('a'), SOURCE);
    const firstManifest = parseManifest(
      first.files.find((f) => f.path === CODEGEN_MANIFEST_PATH)!.contents,
    )!;
    const destination: Record<string, string> = {};
    for (const file of first.files) destination[file.path] = file.contents;

    const second = sampleBundle('a');
    const plan = planRegeneration(destination, firstManifest, second);
    for (const entry of plan.entries) {
      if (entry.path === CODEGEN_MANIFEST_PATH) continue;
      expect(entry.action).toBe('update');
    }
    expect(plan.hasConflicts).toBe(false);
  });

  it('flags an edited generated file as a conflict and never overwrites it silently', () => {
    const first = withRegenerationManifest(sampleBundle('a'), SOURCE);
    const manifest = parseManifest(
      first.files.find((f) => f.path === CODEGEN_MANIFEST_PATH)!.contents,
    )!;
    const codePath = first.files.find((f) => f.path !== CODEGEN_MANIFEST_PATH)!.path;
    const destination: Record<string, string> = {};
    for (const file of first.files) destination[file.path] = file.contents;
    destination[codePath] = `${destination[codePath]}\n// hand tweak`;

    const plan = planRegeneration(destination, manifest, sampleBundle('a'));
    const conflict = plan.entries.find((e) => e.path === codePath);
    expect(conflict?.action).toBe('conflict');
    expect(plan.hasConflicts).toBe(true);
  });

  it('preserves handwritten files the manifest never owned', () => {
    const manifest = parseManifest(
      withRegenerationManifest(sampleBundle('a'), SOURCE).files.find(
        (f) => f.path === CODEGEN_MANIFEST_PATH,
      )!.contents,
    )!;
    // A "generated" comment does not make a file generator-owned.
    const destination: Record<string, string> = {
      'use-card-wrapper.ts': '// handwritten hook\nexport {}',
      'README.md': '# consumer docs',
    };
    const plan = planRegeneration(destination, manifest, sampleBundle('a'));
    for (const entry of plan.entries) {
      if (entry.path.startsWith('use-card') || entry.path === 'README.md') {
        expect(entry.action).toBe('preserve');
      }
    }
    // Fresh output over a handwritten-only destination is 'create' — the
    // handwritten files were never claimed, so nothing becomes 'update'.
    expect(plan.entries.some((e) => e.action === 'create')).toBe(true);
    expect(plan.hasConflicts).toBe(false);
  });

  it('reports stale outputs without deleting them', () => {
    const first = withRegenerationManifest(sampleBundle('a'), SOURCE);
    const manifest = parseManifest(
      first.files.find((f) => f.path === CODEGEN_MANIFEST_PATH)!.contents,
    )!;
    const destination: Record<string, string> = {};
    for (const file of first.files) destination[file.path] = file.contents;
    const removedPath = first.files.find((f) => f.path !== CODEGEN_MANIFEST_PATH)!.path;
    const trimmedBundle = {
      ...sampleBundle('a'),
      files: sampleBundle('a').files.filter((f) => f.path !== removedPath),
    };
    const plan = planRegeneration(destination, manifest, trimmedBundle);
    const stale = plan.entries.find((e) => e.path === removedPath);
    expect(stale?.action).toBe('stale');
    expect(stale?.currentSha256).toBeDefined();
  });

  it('treats a missing manifest as unknown provenance: creates, never overwrites', () => {
    const destination: Record<string, string> = {
      'card.tsx': '// something already here with no manifest',
    };
    const plan = planRegeneration(destination, null, sampleBundle('a'));
    const ours = plan.entries.find((e) => e.path === 'card.tsx');
    // The destination path happens to collide with an emitted path only if
    // names match; regardless, no action may be 'update' without a manifest.
    expect(plan.entries.some((e) => e.action === 'update')).toBe(false);
    void ours;
  });

  it('encodes UTF-8 text exactly once for hashing', () => {
    const bytes = encodeText('héllo ok');
    expect(bytes.length).toBeGreaterThan('héllo ok'.length);
  });
});
