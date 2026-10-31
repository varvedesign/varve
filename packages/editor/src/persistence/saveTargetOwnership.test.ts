import { contentHash } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import {
  type SaveDestinationPlatform,
  type SaveDestinationSession,
  checkChosenSaveDestination,
  rejectTargetOwnedByAnotherSession,
  verifyChosenSaveDestinationUnchanged,
} from './saveTargetOwnership';

/**
 * A narrow platform stub: the ownership guard asks only three questions, and
 * each test states exactly which identity answer (or failure) it returns.
 */
function platformStub(
  overrides: Partial<SaveDestinationPlatform> = {},
): SaveDestinationPlatform & {
  sameNativeFile: ReturnType<typeof vi.fn>;
  sameWebFileHandle: ReturnType<typeof vi.fn>;
  readDocumentText: ReturnType<typeof vi.fn>;
} {
  return {
    sameNativeFile: vi.fn(async (a: string, b: string) => a === b),
    sameWebFileHandle: vi.fn(async (a: string, b: string) => a === b),
    readDocumentText: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
    ...overrides,
  } as SaveDestinationPlatform & {
    sameNativeFile: ReturnType<typeof vi.fn>;
    sameWebFileHandle: ReturnType<typeof vi.fn>;
    readDocumentText: ReturnType<typeof vi.fn>;
  };
}

function session(overrides: Partial<SaveDestinationSession> & { id: string }): SaveDestinationSession {
  return { name: overrides.id, ...overrides };
}

describe('rejectTargetOwnedByAnotherSession', () => {
  it('refuses a native alias of a file another open session owns', async () => {
    // Two spellings, one file: the OS identity API is the only authority.
    const platform = platformStub({ sameNativeFile: vi.fn(async () => true) });
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'native-file', path: '/docs/alias.varve' },
      [
        session({ id: 'active' }),
        session({ id: 'other', filePath: '/docs/original.varve' }),
      ],
      'active',
    );

    expect(issue).toMatchObject({ category: 'destination-in-use' });
    expect(issue?.message).toMatch(/already open/i);
    expect(platform.sameNativeFile).toHaveBeenCalledWith(
      '/docs/alias.varve',
      '/docs/original.varve',
    );
  });

  it('allows a native destination no other session owns', async () => {
    const platform = platformStub({ sameNativeFile: vi.fn(async () => false) });
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'native-file', path: '/docs/new.varve' },
      [session({ id: 'active' }), session({ id: 'other', filePath: '/docs/other.varve' })],
      'active',
    );
    expect(issue).toBeNull();
  });

  it('refuses browser handles that name the same file entry', async () => {
    const platform = platformStub({ sameWebFileHandle: vi.fn(async () => true) });
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'web-file-handle', handleId: 'handle-b', displayName: 'Poster.varve' },
      [session({ id: 'active' }), session({ id: 'other', saveHandleId: 'handle-a' })],
      'active',
    );
    expect(issue).toMatchObject({ category: 'destination-in-use' });
    expect(platform.sameWebFileHandle).toHaveBeenCalledWith('handle-b', 'handle-a');
  });

  it('refuses the same stable Varve Library id in another session', async () => {
    const platform = platformStub();
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'app-storage', fileId: 'library-file' },
      [
        session({ id: 'active' }),
        session({ id: 'other', fileId: 'library-file', libraryStorage: true }),
      ],
      'active',
    );
    expect(issue).toMatchObject({ category: 'destination-in-use' });
  });

  it('allows a different library id', async () => {
    const platform = platformStub();
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'app-storage', fileId: 'library-file' },
      [
        session({ id: 'active' }),
        session({ id: 'other', fileId: 'another-file', libraryStorage: true }),
      ],
      'active',
    );
    expect(issue).toBeNull();
  });

  it('fails closed when the OS cannot establish native identity', async () => {
    const platform = platformStub({
      sameNativeFile: vi.fn(async () => {
        throw new Error('file identity unavailable');
      }),
    });
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'native-file', path: '/docs/alias.varve' },
      [session({ id: 'active' }), session({ id: 'other', filePath: '/docs/original.varve' })],
      'active',
    );
    expect(issue).toMatchObject({ category: 'filesystem-unavailable' });
    expect(issue?.message).toMatch(/refused/i);
  });

  it('fails closed when a browser handle cannot be resolved', async () => {
    const platform = platformStub({
      sameWebFileHandle: vi.fn(async () => {
        throw new Error('handle missing');
      }),
    });
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'web-file-handle', handleId: 'handle-b', displayName: 'Poster.varve' },
      [session({ id: 'active' }), session({ id: 'other', saveHandleId: 'handle-a' })],
      'active',
    );
    expect(issue).toMatchObject({ category: 'filesystem-unavailable' });
  });

  it('ignores sessions with no persistent destination', async () => {
    const platform = platformStub();
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'native-file', path: '/docs/new.varve' },
      [
        session({ id: 'active' }),
        session({ id: 'untitled' }),
        session({ id: 'download', downloadName: 'Poster.varve' }),
      ],
      'active',
    );
    expect(issue).toBeNull();
    expect(platform.sameNativeFile).not.toHaveBeenCalled();
  });

  it('does not refuse a download-only target', async () => {
    const platform = platformStub({ sameNativeFile: vi.fn(async () => true) });
    const issue = await rejectTargetOwnedByAnotherSession(
      platform,
      { kind: 'download-only', suggestedName: 'Poster.varve' },
      [session({ id: 'active' }), session({ id: 'other', filePath: '/docs/original.varve' })],
      'active',
    );
    expect(issue).toBeNull();
    expect(platform.sameNativeFile).not.toHaveBeenCalled();
  });
});

describe('verifyChosenSaveDestinationUnchanged', () => {
  const current = {
    filePath: '/docs/poster.varve',
    diskContentHash: contentHash('{"rev":1}'),
  };

  it('refuses Save As onto the current file after an external change', async () => {
    const platform = platformStub({
      sameNativeFile: vi.fn(async () => true),
      readDocumentText: vi.fn(async () => ({ ok: true as const, text: '{"rev":99}' })),
    });
    const issue = await verifyChosenSaveDestinationUnchanged(
      platform,
      { kind: 'native-file', path: '/docs/poster.varve' },
      current,
    );
    expect(issue).toMatchObject({ category: 'file-changed-externally' });
    expect(issue?.message).toMatch(/changed on disk/i);
  });

  it('allows Save As onto the current file when the bytes still match', async () => {
    const platform = platformStub({
      sameNativeFile: vi.fn(async () => true),
      readDocumentText: vi.fn(async () => ({ ok: true as const, text: '{"rev":1}' })),
    });
    const issue = await verifyChosenSaveDestinationUnchanged(
      platform,
      { kind: 'native-file', path: '/docs/poster.varve' },
      current,
    );
    expect(issue).toBeNull();
  });

  it('allows Save As to a different file without reading the current one', async () => {
    const platform = platformStub({ sameNativeFile: vi.fn(async () => false) });
    const issue = await verifyChosenSaveDestinationUnchanged(
      platform,
      { kind: 'native-file', path: '/docs/elsewhere.varve' },
      current,
    );
    expect(issue).toBeNull();
    expect(platform.readDocumentText).not.toHaveBeenCalled();
  });

  it('fails closed when identity cannot be established', async () => {
    const platform = platformStub({
      sameNativeFile: vi.fn(async () => {
        throw new Error('no identity');
      }),
    });
    const issue = await verifyChosenSaveDestinationUnchanged(
      platform,
      { kind: 'native-file', path: '/docs/poster.varve' },
      current,
    );
    expect(issue).toMatchObject({ category: 'filesystem-unavailable' });
  });

  it('fails closed when the same file exists but cannot be read', async () => {
    const platform = platformStub({
      sameNativeFile: vi.fn(async () => true),
      readDocumentText: vi.fn(async () => ({
        ok: false as const,
        reason: 'unreadable' as const,
        message: 'permission denied',
      })),
    });
    const issue = await verifyChosenSaveDestinationUnchanged(
      platform,
      { kind: 'native-file', path: '/docs/poster.varve' },
      current,
    );
    expect(issue).toMatchObject({ category: 'filesystem-unavailable' });
  });

  it('allows recreating the current file when it is gone', async () => {
    const platform = platformStub({
      sameNativeFile: vi.fn(async () => true),
      readDocumentText: vi.fn(async () => ({ ok: false as const, reason: 'missing' as const })),
    });
    const issue = await verifyChosenSaveDestinationUnchanged(
      platform,
      { kind: 'native-file', path: '/docs/poster.varve' },
      current,
    );
    expect(issue).toBeNull();
  });

  it('does nothing without a session baseline', async () => {
    const platform = platformStub();
    const issue = await verifyChosenSaveDestinationUnchanged(
      platform,
      { kind: 'native-file', path: '/docs/poster.varve' },
      { filePath: '/docs/poster.varve' },
    );
    expect(issue).toBeNull();
    expect(platform.sameNativeFile).not.toHaveBeenCalled();
  });

  it('does not inspect browser or library targets', async () => {
    const platform = platformStub();
    expect(
      await verifyChosenSaveDestinationUnchanged(
        platform,
        { kind: 'web-file-handle', handleId: 'h', displayName: 'p.varve' },
        current,
      ),
    ).toBeNull();
    expect(platform.sameNativeFile).not.toHaveBeenCalled();
  });
});

describe('checkChosenSaveDestination', () => {
  const platform = platformStub({
    sameNativeFile: vi.fn(async (a: string, b: string) => {
      if (a === '/docs/alias.varve' && b === '/docs/original.varve') return true;
      return a === b;
    }),
    readDocumentText: vi.fn(async () => ({
      ok: true as const,
      text: '{"rev":1}',
    })),
  });

  it('refuses another open document before checking the current file', async () => {
    const issue = await checkChosenSaveDestination(
      platform,
      { kind: 'native-file', path: '/docs/alias.varve' },
      [session({ id: 'active' }), session({ id: 'other', filePath: '/docs/original.varve' })],
      'active',
      { filePath: '/docs/poster.varve', diskContentHash: contentHash('{"rev":1}') },
    );
    expect(issue).toMatchObject({ category: 'destination-in-use' });
    expect(platform.readDocumentText).not.toHaveBeenCalled();
  });

  it('checks the current file bytes when no other session owns the target', async () => {
    const issue = await checkChosenSaveDestination(
      platform,
      { kind: 'native-file', path: '/docs/poster.varve' },
      [session({ id: 'active' })],
      'active',
      { filePath: '/docs/poster.varve', diskContentHash: contentHash('{"rev":1}') },
    );
    expect(issue).toBeNull();
    expect(platform.readDocumentText).toHaveBeenCalledWith('/docs/poster.varve');
  });
});
