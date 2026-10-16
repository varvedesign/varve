import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from './protocol';

/**
 * Cross-implementation conformance: the Rust room host
 * (crates/varve-room/tests/protocol_conformance.rs) checks the same
 * fixture file, so both wire implementations accept and reject identical
 * frames. Extend the fixture, never one implementation alone.
 */
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'protocol-v1.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  valid: unknown[];
  invalid: unknown[];
};

describe('protocol v1 conformance fixtures', () => {
  it('accepts every valid fixture frame', () => {
    for (const frame of fixture.valid) {
      const asClient = parseClientMessage(frame);
      const asServer = parseServerMessage(frame);
      expect({ frame, parsed: asClient ?? asServer }).toEqual({
        frame,
        parsed: expect.any(Object),
      });
      expect(asClient === null && asServer === null).toBe(false);
    }
  });

  it('rejects every invalid fixture frame', () => {
    for (const frame of fixture.invalid) {
      expect({ frame, parsed: parseClientMessage(frame) }).toEqual({ frame, parsed: null });
      expect({ frame, parsed: parseServerMessage(frame) }).toEqual({ frame, parsed: null });
    }
  });
});
