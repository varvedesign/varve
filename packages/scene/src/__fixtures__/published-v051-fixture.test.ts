import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { validateDocument } from '../document';
import { DocumentCodec } from '../documentCodec';
import {
  CURRENT_DOCUMENT_VERSION,
  migrateDocumentDetailed,
  migrateDocumentJson,
  serializeDocument,
} from '../version';
import publishedFixture from './published-v0.5.1-type-v2.33.json';

/**
 * A schema 2.33 document as shipped in the v0.5.1 tag
 * (`scripts/screenshots/fixtures/type.varve`). Varve 0.6.0 writes 2.34, which
 * adds the optional `textFrame` style; files saved by 0.5.x must still open
 * and keep their content without gaining a frame style.
 */
const fixture = publishedFixture as unknown as Record<string, unknown>;
const fixtureJson = JSON.stringify(publishedFixture);

const TEXT_IDS = ['type-display', 'type-scale', 'type-subhead', 'type-body', 'type-caption'];

function nodesOf(doc: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return doc.nodes as Record<string, Record<string, unknown>>;
}

describe('Published v0.5.1 (schema 2.33) document fixture', () => {
  it('is a 2.33 document and the current schema is 2.34', () => {
    expect(fixture.formatVersion).toBe('2.33');
    expect(CURRENT_DOCUMENT_VERSION).toBe('2.34');
  });

  it('migrates 2.33 to 2.34 without warnings', () => {
    const result = migrateDocumentDetailed(structuredClone(fixture));
    expect(result).not.toBeNull();
    expect(result!.fromVersion).toBe('2.33');
    expect(result!.toVersion).toBe('2.34');
    expect(result!.migrated).toBe(true);
    expect(result!.warnings).toEqual([]);
    expect(result!.document.formatVersion).toBe('2.34');
  });

  it('keeps every node and all text, and invents no text frame style', () => {
    const migrated = migrateDocumentJson(fixtureJson);
    expect(migrated).not.toBeNull();

    const before = nodesOf(fixture);
    const after = nodesOf(migrated!);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(migrated!.rootChildren).toEqual(fixture.rootChildren);
    expect(after['type-frame']?.children).toEqual(before['type-frame']?.children);

    for (const id of TEXT_IDS) {
      expect(after[id]?.kind).toBe('text');
      expect(after[id]?.text).toBe(before[id]?.text);
      expect(after[id]?.textFrame).toBeUndefined();
    }
  });

  it('passes validateDocument after migration', () => {
    const migrated = migrateDocumentJson(fixtureJson);
    const validation = validateDocument(migrated as unknown as Document);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('opens through DocumentCodec at 2.34', () => {
    const decoded = DocumentCodec.decode(fixtureJson);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.formatVersion).toBe('2.34');
    const body = decoded.document.nodes['type-body'];
    expect(body?.kind).toBe('text');
    expect(body?.kind === 'text' && body.textFrame).toBeUndefined();
  });

  it('round-trips: serialize -> migrate again stays 2.34 and unchanged', () => {
    const migrated = migrateDocumentJson(fixtureJson);
    const json = serializeDocument(migrated!);
    expect(JSON.parse(json).formatVersion).toBe('2.34');

    const again = migrateDocumentDetailed(JSON.parse(json));
    expect(again).not.toBeNull();
    expect(again!.migrated).toBe(false);
    expect(again!.document.formatVersion).toBe('2.34');
    expect(serializeDocument(again!.document)).toBe(json);

    const validation = validateDocument(again!.document as unknown as Document);
    expect(validation.valid).toBe(true);
  });
});
