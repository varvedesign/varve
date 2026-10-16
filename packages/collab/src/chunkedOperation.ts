/**
 * Chunked operation uploads (protocol v1).
 *
 * An operation frame above `PROTOCOL_LIMITS.maxOperationBytes` is split into
 * bounded `operation-chunk` frames and reassembled by the host before it is
 * parsed. The motivating case is an embedded image asset: the capture for a
 * newly added `DocumentAsset` carries the data URL (`packages/history` →
 * `diff.ts`), and the document's own inline-asset bound is 10 MB, so
 * inserting a photo into a shared document is an ordinary way to produce a
 * multi-megabyte operation.
 *
 * Guarantees:
 * - Framing only. The reassembled text is byte-identical to the inline frame
 *   the client would otherwise have sent, and the host validates it through
 *   the same parser and shape bounds.
 * - Bounded: `maxUploadChunkBytes` of UTF-8 payload per chunk and
 *   `maxChunkedOperationBytes` in total; a frame beyond the ceiling is
 *   reported as `unsupported` so the caller can surface it instead of
 *   silently dropping the edit.
 * - Integrity: `digest` is the SHA-256 hex of the reassembled frame's UTF-8
 *   bytes, verified by the host. This catches truncation and reassembly
 *   faults; it is not a cryptographic trust boundary (the socket is already
 *   authenticated and transport-integrity-checked).
 * - Chunks never split a code point, so every chunk is a valid string.
 *
 * Pure module: no transport, no DOM, no I/O.
 */

import { sha256Utf8 } from '@varve/scene';
import { PROTOCOL_LIMITS, utf8ByteLength } from './protocol';

export type ChunkedUploadPlan =
  | {
      ok: true;
      uploadId: string;
      totalBytes: number;
      chunkCount: number;
      digest: string;
      /** UTF-8-bounded slices of the serialized frame, in order. */
      chunks: string[];
    }
  | { ok: false; reason: 'too-large'; totalBytes: number };

/**
 * Split a serialized operation frame into a chunked-upload plan.
 * `uploadId` is supplied by the caller so the plan stays deterministic and
 * testable; the transport mints it from the platform CSPRNG.
 */
export function planChunkedOperation(frameText: string, uploadId: string): ChunkedUploadPlan {
  const totalBytes = utf8ByteLength(frameText);
  if (totalBytes > PROTOCOL_LIMITS.maxChunkedOperationBytes) {
    return { ok: false, reason: 'too-large', totalBytes };
  }
  const chunks = sliceByUtf8Bytes(frameText, PROTOCOL_LIMITS.maxUploadChunkBytes);
  return {
    ok: true,
    uploadId,
    totalBytes,
    chunkCount: chunks.length,
    digest: sha256Utf8(frameText),
    chunks,
  };
}

/**
 * Slice text into pieces of at most `maxBytes` UTF-8 bytes without splitting
 * a code point (no lone surrogates across a boundary) and without building a
 * code-point array for the whole frame.
 */
export function sliceByUtf8Bytes(text: string, maxBytes: number): string[] {
  const out: string[] = [];
  let start = 0;
  let bytes = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const point = text.codePointAt(cursor) ?? 0;
    const cost = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > 0 && bytes + cost > maxBytes) {
      out.push(text.slice(start, cursor));
      start = cursor;
      bytes = 0;
      continue;
    }
    bytes += cost;
    cursor += point > 0xffff ? 2 : 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}
