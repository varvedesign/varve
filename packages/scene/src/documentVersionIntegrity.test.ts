/**
 * Document version-field robustness.
 *
 * Evidence class: storytold/designcraft #1049 ("One unusable IDML CJK metric
 * makes the whole file unopenable") and #744 (public API hardening). The
 * transferable defect is a load boundary that trusts one field's type: a
 * single malformed value fails or crashes the whole open instead of being
 * reported.
 *
 * `DocumentCodec.decode` documents a result contract
 * (`ok: false` + warnings) for any bytes it is handed. Varve only ever writes
 * `formatVersion` as a string, so a JSON number, boolean, array or object in
 * that position means foreign or corrupted bytes — the case these tests pin.
 */

import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';

/** A structurally valid document whose version field has been tampered with. */
function documentJsonWithVersion(version: unknown): string {
  const doc = addNode(
    createDocument('Version integrity', true),
    makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
  );
  const parsed = JSON.parse(DocumentCodec.encode(doc)) as Record<string, unknown>;
  parsed.formatVersion = version;
  return JSON.stringify(parsed);
}

const malformedVersions: Array<[string, unknown]> = [
  ['a JSON number', 2.33],
  ['a JSON boolean', true],
  ['an array', [2, 33]],
  ['an object', { major: 2, minor: 33 }],
  // A suffixed string is not a version Varve ever wrote. It is reported like
  // any other unreadable field rather than guessed at.
  ['a non-numeric string', '2.33-beta'],
];

describe('document version field robustness', () => {
  for (const [label, version] of malformedVersions) {
    it(`returns a result instead of throwing when formatVersion is ${label}`, () => {
      expect(() => DocumentCodec.decode(documentJsonWithVersion(version))).not.toThrow();
    });

    it(`still opens the document when formatVersion is ${label}`, () => {
      const result = DocumentCodec.decode(documentJsonWithVersion(version));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.document.nodes.n1).toBeDefined();
      expect(result.warnings.some((item) => item.code === 'document.unrecognized-version')).toBe(
        true,
      );
    });
  }

  it('treats a null version field as a missing one, not as an unrecognized one', () => {
    // `null` carries no information, so the legacy path is the honest reading.
    const result = DocumentCodec.decode(documentJsonWithVersion(null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.n1).toBeDefined();
  });

  it('still migrates a genuinely legacy string version', () => {
    const result = DocumentCodec.decode(documentJsonWithVersion('1.0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((item) => item.code === 'document.migrated')).toBe(true);
  });

  it('does not run migrations for an unrecognized version', () => {
    // Running 40 shape-guarded migrations over bytes whose vintage is unknown
    // is the larger risk; loading as-is with a warning is the honest outcome.
    const result = DocumentCodec.decode(documentJsonWithVersion({ major: 2 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((item) => item.code === 'document.migrated')).toBe(false);
  });
});
