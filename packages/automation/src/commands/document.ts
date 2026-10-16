import { defineCommand } from '../catalog';
import { type Infer, s } from '../schema';
import { defaultInsertionParent } from '../surface';

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
      defaultParentId: defaultInsertionParent(doc),
      canvas: typeof width === 'number' && typeof height === 'number' ? { width, height } : null,
      instance: { mode: info.mode, instanceId: info.instanceId, generation: info.generation },
    };
  },
});

export const DOCUMENT_COMMANDS = [documentInfo];
