/**
 * Canonical document codec for import/export and persistence boundaries.
 *
 * All external document bytes should pass through this module before they enter
 * editor state. The codec migrates, normalizes broken references, and returns
 * structured warnings so callers can report compatibility issues honestly.
 *
 * Research basis: local-first design tools need one migration/validation path
 * across disk, recovery, clipboard, and foreign-format imports; this avoids the
 * drift seen when each surface parses raw JSON independently.
 */

export { DocumentCodec } from './documentCodec/codec';
export type {
  DocumentClosure,
  DocumentCodecWarning,
  DocumentDecodeResult,
  DocumentNormalizeResult,
} from './documentCodec/types';
