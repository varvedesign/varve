/**
 * The runtime side of `varve.document.save`: write the committed document to
 * disk and report where, how large, and which hash. Lives in the CLI because
 * the core has no file system.
 *
 * Rules:
 * - With no `path`, the session's configured destination is used. If the
 *   session has none, the command is refused rather than guessing a location.
 * - A caller-supplied `path` is honored only when write roots are configured
 *   and the path resolves inside one. Without roots there is no safe place an
 *   agent may name, so naming one is refused.
 * - Saves are compare-and-swap against the last bytes this session wrote (or
 *   loaded), so another writer's newer file is never overwritten.
 */
import type { ErrorCode, ExternalHandler, ExternalResult } from '@varve/automation';
import { FileError, type PathPolicy, writeTextAtomic } from './files';
import { encodeVerified } from './session';

export interface SaveDestination {
  path: string;
  /** `in-place` replaces the loaded document; `out` writes a new file. */
  kind: 'in-place' | 'out';
  overwrite: boolean;
}

export interface SaveHandlerOptions {
  policy: PathPolicy;
  destination: SaveDestination | null;
  /** Hash of the bytes the session loaded from `destination`, if any. */
  loadedHash: string | null;
}

function codeFor(error: FileError): ErrorCode {
  switch (error.code) {
    case 'EXISTS':
    case 'CHANGED_ON_DISK':
    case 'LOCKED':
      return 'CONFLICT';
    case 'NOT_ALLOWED':
      return 'PERMISSION_DENIED';
    case 'WRITE_FAILED':
    case 'READ_FAILED':
      return 'INTERNAL';
    default:
      return 'INVALID_ARGUMENT';
  }
}

export function createSaveHandler(options: SaveHandlerOptions): ExternalHandler {
  // Hash of the last bytes this session is known to have placed at the default
  // destination (initially the loaded bytes). A save replaces only that.
  let knownHash = options.loadedHash;
  let createdByUs = false;

  return (args, env): ExternalResult => {
    const requested = (args as { path?: string }).path;
    let target: string;
    let mode: Parameters<typeof writeTextAtomic>[3];
    const usingDefault = requested === undefined;

    if (usingDefault) {
      if (!options.destination) {
        return {
          ok: false,
          code: 'INVALID_ARGUMENT',
          message: 'this session has no save destination configured',
          hint: 'start the session with --in-place or --out <file>, or pass a path inside a write root',
        };
      }
      target = options.destination.path;
      if (options.destination.kind === 'in-place' || createdByUs) {
        if (knownHash === null) {
          return {
            ok: false,
            code: 'CONFLICT',
            message: 'the destination has no known content to replace',
          };
        }
        mode = { kind: 'replace-expected', expectedHash: knownHash };
      } else {
        mode = options.destination.overwrite ? { kind: 'replace-any' } : { kind: 'create-new' };
      }
    } else {
      if (!options.policy.restricted) {
        return {
          ok: false,
          code: 'PERMISSION_DENIED',
          message: 'a caller-supplied path is not accepted because no write roots are configured',
          hint: 'configure VARVE_WRITE_ROOTS (or --write-root) for this session, or save to the default destination',
        };
      }
      target = requested;
      mode = { kind: 'create-new' };
    }

    try {
      const text = encodeVerified(env.authority.getDocument());
      const saved = writeTextAtomic(options.policy, target, text, mode);
      if (usingDefault) {
        knownHash = saved.contentHash;
        createdByUs = true;
      }
      return {
        ok: true,
        summary: `Saved revision ${env.authority.getRevision()} to ${saved.path} (${saved.bytes} bytes).`,
        output: {
          path: saved.path,
          bytes: saved.bytes,
          contentHash: saved.contentHash,
          revision: env.authority.getRevision(),
        },
        durable: {
          saved: true,
          path: saved.path,
          bytes: saved.bytes,
          contentHash: saved.contentHash,
        },
      };
    } catch (error) {
      if (error instanceof FileError) {
        return { ok: false, code: codeFor(error), message: error.message };
      }
      return {
        ok: false,
        code: 'INTERNAL',
        message: `save failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  };
}
