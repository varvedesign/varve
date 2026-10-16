import { defineCommand } from '../catalog';
import { type Infer, s } from '../schema';
import { resolveDefaultParent } from '../surface';

const INFO_OUTPUT = s.object({
  documentId: s.string({ maxBytes: 128 }),
  name: s.string({ maxBytes: 1024 }),
  formatVersion: s.string({ maxBytes: 32 }),
  revision: s.integer({ min: 0 }),
  nodeCount: s.integer({ min: 0 }),
  pageCount: s.integer({ min: 0 }),
  activePageId: s.nullable(s.string({ maxBytes: 128 })),
  defaultParentId: s.nullable(s.string({ maxBytes: 128 })),
  canvas: s.nullable(s.object({ width: s.number(), height: s.number() })),
  instance: s.object({
    mode: s.enum(['headless', 'connected'] as const),
    instanceId: s.string({ maxBytes: 128 }),
    generation: s.string({ maxBytes: 128 }),
  }),
});

type InfoOutput = Infer<typeof INFO_OUTPUT>;

export const documentInfo = defineCommand({
  id: 'varve.document.info',
  version: 1,
  title: 'Document and session info',
  summary:
    'Identify the document this session is attached to: id, name, revision, runtime mode, instance and session generation. Call this first and pin the ids it returns on later requests.',
  keywords: ['session', 'target', 'revision', 'attach', 'status', 'whoami'],
  effect: 'read',
  authorization: 'read',
  runtimes: ['headless', 'connected'],
  input: s.object({}),
  output: INFO_OUTPUT,
  examples: [{ title: 'Attach and identify', args: {} }],
  inspect(authority): InfoOutput {
    const doc = authority.getDocument();
    const info = authority.info();
    const page =
      doc.pages?.find((candidate) => candidate.id === doc.activePageId) ?? doc.pages?.[0];
    const width = page?.width ?? doc.canvasWidth;
    const height = page?.height ?? doc.canvasHeight;
    return {
      documentId: info.documentId,
      name: doc.name,
      formatVersion: doc.formatVersion,
      revision: authority.getRevision(),
      nodeCount: Object.keys(doc.nodes).length,
      pageCount: doc.pages?.length ?? 0,
      activePageId: doc.pages && doc.pages.length > 0 ? (page?.id ?? null) : null,
      defaultParentId: resolveDefaultParent(authority),
      canvas: typeof width === 'number' && typeof height === 'number' ? { width, height } : null,
      instance: { mode: info.mode, instanceId: info.instanceId, generation: info.generation },
    };
  },
});

const SAVE_INPUT = s.object({
  path: s.optional(
    s.string({
      maxBytes: 4096,
      minLength: 1,
      description:
        'Destination file. Omit to use the session default. A path is only honored inside the session write roots.',
    }),
  ),
});

const SAVE_OUTPUT = s.object({
  path: s.string({ maxBytes: 4096 }),
  // Always reported for a headless file write. A live application writes
  // through its own persistence layer, which can encode or encrypt the bytes
  // it stores, so it reports only what it can state truthfully.
  bytes: s.optional(s.integer({ min: 0 })),
  contentHash: s.optional(s.string({ maxBytes: 64 })),
  revision: s.integer({
    min: 0,
    description:
      'The revision that was written. The document may have moved on while the write ran.',
  }),
});

export const documentSave = defineCommand({
  id: 'varve.document.save',
  version: 1,
  title: 'Save the document to a file',
  summary:
    'Write the current committed document to disk atomically and report the destination, size and hash. A committed edit is not a saved file until this succeeds. Headless: refuses to overwrite files it did not create unless the session was started to write that file. Live application: saves only to the place the person already chose for this document (the same as Save); a document that has never been saved, or a request for another path, needs a person and nothing is written.',
  keywords: ['write', 'persist', 'export', 'file', 'durable'],
  effect: 'external',
  authorization: 'export',
  runtimes: ['headless', 'connected'],
  input: SAVE_INPUT,
  output: SAVE_OUTPUT,
  examples: [{ title: 'Save to the session destination', args: {} }],
});

export const DOCUMENT_COMMANDS = [documentInfo, documentSave];
