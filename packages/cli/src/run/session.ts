/**
 * Opens a headless automation session over a document file (or a new
 * document). Distinct from a connected session by construction: this never
 * looks for, attaches to, or substitutes for a running application.
 */
import {
  createStandardCatalog,
  Executor,
  type ExecutorContext,
  HeadlessAuthority,
  IdempotencyStore,
  ownerPrincipal,
  type Principal,
} from '@varve/automation';
import { createDocument, type Document, DocumentCodec } from '@varve/scene';
import { FileError, type LoadedText, type PathPolicy, readTextFile } from './files';

export const MAX_DOCUMENT_BYTES_DEFAULT = 256 * 1024 * 1024;

export interface OpenedSession {
  executor: Executor;
  idempotency: IdempotencyStore;
  authority: HeadlessAuthority;
  ctx: ExecutorContext;
  principal: Principal;
  /** Present when the session was loaded from a file. */
  source: LoadedText | null;
  warnings: string[];
}

export function maxDocumentBytes(env: Record<string, string | undefined>): number {
  const raw = env.VARVE_MAX_DOCUMENT_BYTES;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MAX_DOCUMENT_BYTES_DEFAULT;
}

export function openFileSession(
  policy: PathPolicy,
  path: string,
  maxBytes: number,
  principal: Principal = ownerPrincipal('cli-owner', 'Local user (CLI)'),
): OpenedSession {
  const canonical = policy.resolveRead(path);
  const source = readTextFile(canonical, maxBytes);
  const decoded = DocumentCodec.decode(source.text);
  if (!decoded.ok) {
    throw new FileError('READ_FAILED', `invalid document ${path}: ${decoded.error}`);
  }
  return build(
    decoded.document,
    source,
    principal,
    decoded.warnings.map((w) => w.message),
  );
}

export function openNewSession(
  name: string,
  principal: Principal = ownerPrincipal('cli-owner', 'Local user (CLI)'),
): OpenedSession {
  return build(createDocument(name), null, principal, []);
}

function build(
  document: Document,
  source: LoadedText | null,
  principal: Principal,
  warnings: string[],
): OpenedSession {
  const authority = new HeadlessAuthority({ document });
  const idempotency = new IdempotencyStore();
  const executor = new Executor({ catalog: createStandardCatalog(), idempotency });
  return {
    executor,
    idempotency,
    authority,
    principal,
    source,
    warnings,
    ctx: { principal, authority },
  };
}

/** Encode and prove the result decodes, so a bad document is never written. */
export function encodeVerified(document: Document): string {
  const text = DocumentCodec.encode(document);
  const check = DocumentCodec.decode(text);
  if (!check.ok) {
    throw new FileError(
      'WRITE_FAILED',
      `the edited document failed validation and was not written: ${check.error}`,
    );
  }
  return text;
}
