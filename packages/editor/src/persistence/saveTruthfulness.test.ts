/**
 * What a save is allowed to claim.
 *
 * Evidence: storytold/designcraft #708 ("Web Save clears dirty state even when
 * download initiation fails") and #1050 / #1031-2, where `format::save` never
 * read its bytes back, wrote a document the app could not open, reported
 * success and deleted the recovery copy.
 */

import {
  addNode,
  createDocument,
  DocumentCodec,
  makeShapeNode,
  NonFiniteDocumentError,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { decideSaveSuccess, verifyEncodedDocument } from './saveTruthfulness';

describe('decideSaveSuccess', () => {
  it('never clears dirty for a hand-off that is not a destination', () => {
    // A browser snapshot download is a hand-off to the browser, not a place
    // the app can read back: not durable, so not clean, and the status must
    // settle rather than sit at "Saving…".
    expect(decideSaveSuccess({ durable: false, clean: true })).toEqual({
      marksClean: false,
      settleSaveState: 'idle',
    });
  });

  it('clears dirty and settles on saved for a durable write of the current revision', () => {
    expect(decideSaveSuccess({ durable: true, clean: true })).toEqual({
      marksClean: true,
      settleSaveState: 'saved',
    });
  });

  it('settles on saved but keeps dirty when the user edited during the write', () => {
    expect(decideSaveSuccess({ durable: true, clean: false })).toEqual({
      marksClean: false,
      settleSaveState: 'saved',
    });
  });
});

function encodedDocument(): string {
  const doc = addNode(
    createDocument('Save truthfulness', true),
    makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
  );
  return DocumentCodec.encode(doc);
}

describe('verifyEncodedDocument', () => {
  it('accepts the text of a document Varve writes', () => {
    expect(verifyEncodedDocument(encodedDocument())).toBeNull();
  });

  it('rejects text that is not JSON', () => {
    const issue = verifyEncodedDocument('{"nodes":');
    expect(issue).not.toBeNull();
    expect(issue?.message).toContain('could not be read back');
  });

  it('rejects a payload that is JSON but not a document', () => {
    const issue = verifyEncodedDocument(JSON.stringify({ hello: 'world' }));
    expect(issue).not.toBeNull();
  });

  it('names the codec reason so a save failure is diagnosable', () => {
    const issue = verifyEncodedDocument(JSON.stringify({ id: 1, name: 'x' }));
    expect(issue?.message).toContain('Document id must be a string');
  });
});

describe('non-finite geometry through the persistence path', () => {
  it('refuses to write a document whose number would become null', () => {
    // Before the repair the encoded text contained `"y":null`, the reopen
    // SUCCEEDED, and the shape came back with `y === null` — silent corruption
    // of a coordinate, which is the shape of storytold/designcraft #1050.
    const doc = addNode(
      createDocument('Non-finite', true),
      makeShapeNode('n1', { kind: 'rect', x: 0, y: Number.POSITIVE_INFINITY, w: 10, h: 10 }),
    );
    expect(() => DocumentCodec.encode(doc)).toThrow(NonFiniteDocumentError);
  });

  it('names the offending node and field so the failure is diagnosable', () => {
    const doc = addNode(
      createDocument('Non-finite', true),
      makeShapeNode('n1', { kind: 'rect', x: 0, y: Number.NEGATIVE_INFINITY, w: 10, h: 10 }),
    );
    try {
      DocumentCodec.encode(doc);
      expect.unreachable('a non-finite coordinate must not be writable');
    } catch (error) {
      expect(error).toBeInstanceOf(NonFiniteDocumentError);
      expect((error as NonFiniteDocumentError).paths).toContain('nodes.n1.shape.y');
    }
  });

  it('still writes extreme but finite values', () => {
    // 1e308 is representable; the upstream defect was arithmetic that produced
    // infinity from it, not the extreme input itself.
    const doc = addNode(
      createDocument('Extreme finite', true),
      makeShapeNode('n1', { kind: 'rect', x: 1e308, y: 0, w: 10, h: 10 }),
    );
    const reopened = DocumentCodec.decode(DocumentCodec.encode(doc));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect((reopened.document.nodes.n1 as { shape?: { x?: unknown } }).shape?.x).toBe(1e308);
  });
});
