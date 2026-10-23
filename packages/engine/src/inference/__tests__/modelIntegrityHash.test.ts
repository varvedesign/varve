/**
 * Every downloadable or bundled model file must expose a SHA-256 the
 * downloader actually reads. A hash stored only under a field the
 * downloader ignores is the same as no hash.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvedIntegrityHash } from '../integrityHash';
import { listAllModels } from '../modelCatalog';
import type { ModelComponentEntry } from '../types';

const manifestPath = resolve(__dirname, '../../../../../apps/desktop/public/models/manifest.json');

interface RawManifestModel {
  id: string;
  bundled?: boolean;
  remoteUrl?: string;
  sha256?: string | null;
  checksum?: string;
  components?: Array<
    ModelComponentEntry & {
      sha256?: string | null;
    }
  >;
}

function artifactLabel(modelId: string, componentId?: string): string {
  return componentId ? `${modelId}/${componentId}` : modelId;
}

type HashableModel = {
  id: string;
  bundled?: boolean;
  remoteUrl?: string;
  checksum?: string;
  sha256?: string | null;
  components?: Array<{ id: string; checksum?: string; sha256?: string | null }>;
};

function collectUnverified(models: HashableModel[]): string[] {
  const missing: string[] = [];
  for (const model of models) {
    const components = model.components ?? [];
    if (components.length > 0) {
      for (const component of components) {
        if (!resolvedIntegrityHash(component)) {
          missing.push(artifactLabel(model.id, component.id));
        }
      }
      continue;
    }
    const hasFile = Boolean(model.bundled || model.remoteUrl);
    if (hasFile && !resolvedIntegrityHash(model)) {
      missing.push(artifactLabel(model.id));
    }
  }
  return missing;
}

describe('model integrity hashes', () => {
  it('resolvedIntegrityHash reads checksum or sha256', () => {
    expect(resolvedIntegrityHash({ checksum: 'A'.repeat(64) })).toBe('a'.repeat(64));
    expect(resolvedIntegrityHash({ sha256: 'b'.repeat(64) })).toBe('b'.repeat(64));
    expect(resolvedIntegrityHash({ checksum: '', sha256: 'c'.repeat(64) })).toBe('c'.repeat(64));
    expect(resolvedIntegrityHash({ checksum: 'not-a-hash', sha256: null })).toBeNull();
  });

  it('fails if any shipped model file lacks a hash the downloader verifies', () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { models: RawManifestModel[] };
    const fromManifest = collectUnverified(raw.models);
    const fromCatalog = collectUnverified(listAllModels());
    const missing = [...new Set([...fromManifest, ...fromCatalog])];
    expect(missing, `unverified model files:\n${missing.join('\n')}`).toEqual([]);
  });

  it('DownloadManager resolves hashes through resolvedIntegrityHash', () => {
    const downloader = readFileSync(resolve(__dirname, '../core/DownloadManager.ts'), 'utf-8');
    expect(downloader).toContain('resolvedIntegrityHash');
  });
});
