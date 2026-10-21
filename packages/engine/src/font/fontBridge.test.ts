import { afterEach, describe, expect, it } from 'vitest';
import { FontRegistry } from '../fontRegistry';
import { createFontCatalogFromRegistry } from './fontBridge';
import { FontResolver } from './fontResolver';
import { setFontAvailabilityProbeForTest } from './systemFontProbe';

const FIRST_HASH = 'a'.repeat(64);
const SECOND_HASH = 'b'.repeat(64);

describe('createFontCatalogFromRegistry', () => {
  it('projects every exact face and preserves parsed registry metadata', () => {
    const registry = new FontRegistry([]);
    registry.registerMetadata({
      family: 'Atlas Variable',
      vendor: 'Varve Foundry',
      version: 'Version 2.1',
      unitsPerEm: 2048,
      ascender: 1900,
      descender: -500,
      lineGap: 100,
      glyphCount: 1200,
      embeddingRights: 'editable',
      openTypeFeatures: ['kern', 'liga'],
      namedInstances: [{ name: 'Text', coordinates: { wght: 400 } }],
    });
    registry.register({
      family: 'Atlas Variable',
      weight: 400,
      style: 'normal',
      source: 'user',
      postScriptName: 'Atlas-Regular',
      faceKey: `sha256:${FIRST_HASH}:single`,
      axisDefinitions: [{ tag: 'wght', name: 'Weight', min: 300, default: 400, max: 800 }],
    });
    registry.register({
      family: 'Atlas Variable',
      weight: 700,
      style: 'normal',
      source: 'user',
      postScriptName: 'Atlas-Bold',
      faceKey: `sha256:${SECOND_HASH}:single`,
      axisDefinitions: [{ tag: 'wght', name: 'Weight', min: 300, default: 400, max: 800 }],
    });

    const catalog = createFontCatalogFromRegistry(registry);
    const entries = catalog.getEntriesForFamily('Atlas Variable');

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.identity.contentHash)).toEqual(
      expect.arrayContaining([FIRST_HASH, SECOND_HASH]),
    );
    expect(entries.map((entry) => entry.identity.postScriptName)).toEqual(
      expect.arrayContaining(['Atlas-Regular', 'Atlas-Bold']),
    );
    expect(entries[0]?.vendor).toBe('Varve Foundry');
    expect(entries[0]?.unitsPerEm).toBe(2048);
    expect(entries[0]?.axes).toEqual([
      { tag: 'wght', name: 'Weight', min: 300, default: 400, max: 800 },
    ]);
    expect(entries[0]?.namedInstances).toEqual([{ name: 'Text', coordinates: { wght: 400 } }]);
  });

  it('keeps family-only registry entries distinct without claiming exact hashes', () => {
    const registry = new FontRegistry([]);
    registry.register({
      family: 'Legacy Sans',
      weight: 400,
      style: 'normal',
      source: 'system',
    });
    registry.register({
      family: 'Legacy Sans',
      weight: 700,
      style: 'normal',
      source: 'system',
    });

    const entries = createFontCatalogFromRegistry(registry).getEntriesForFamily('Legacy Sans');

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.identity.hashAlgorithm === 'unknown')).toBe(true);
    expect(entries[0]?.identity.contentHash).toContain('registry:Legacy Sans:system');
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it('withholds a seed family the host cannot resolve', () => {
    // The registry seeds Meiryo; this host does not have it. Projecting it into
    // the catalog made `detectMissing` treat the fallback as faithful
    // typography, so the user saw wrong glyphs with no warning.
    setFontAvailabilityProbeForTest(
      (families) => new Set([...families].filter((family) => family !== 'Meiryo')),
    );

    const catalog = createFontCatalogFromRegistry(new FontRegistry());

    expect(catalog.getEntriesForFamily('Meiryo')).toHaveLength(0);
    expect(catalog.getEntriesForFamily('Arial').length).toBeGreaterThan(0);
  });

  it('makes an unresolvable seed family report as a missing font', () => {
    setFontAvailabilityProbeForTest(
      (families) => new Set([...families].filter((family) => family !== 'Meiryo')),
    );
    const catalog = createFontCatalogFromRegistry(new FontRegistry());
    const resolver = new FontResolver();

    const missing = resolver.detectMissing(
      {
        nodes: [
          {
            id: 't1',
            kind: 'text',
            fontFamily: 'Meiryo',
            runs: [],
          },
        ],
        styles: {},
        stories: [],
      } as never,
      catalog,
    );

    expect(missing.map((entry) => entry.familyName)).toContain('Meiryo');
    expect(missing[0]?.status).toBe('missing-family');
  });

  it('keeps seed families when the host cannot be probed', () => {
    setFontAvailabilityProbeForTest(() => null);

    const catalog = createFontCatalogFromRegistry(new FontRegistry());

    expect(catalog.getEntriesForFamily('Meiryo').length).toBeGreaterThan(0);
  });
});

afterEach(() => {
  setFontAvailabilityProbeForTest(null);
});
