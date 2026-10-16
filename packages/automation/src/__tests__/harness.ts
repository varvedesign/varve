import { createDocument, type Document } from '@varve/scene';
import { createStandardCatalog } from '../commands';
import { Executor, type ExecutorContext, type ExecutorOptions } from '../executor';
import { HeadlessAuthority } from '../headless';
import { type AuthorizationClass, ownerPrincipal, type Principal } from '../principal';
import type { Receipt } from '../receipt';

export interface Session {
  executor: Executor;
  authority: HeadlessAuthority;
  ctx: ExecutorContext;
  /** Execute one command with the owner principal; returns the receipt. */
  run(command: string, args?: unknown, extra?: Record<string, unknown>): Promise<Receipt>;
  as(principal: Principal): ExecutorContext;
  doc(): Document;
}

export function principal(
  id: string,
  grants: readonly AuthorizationClass[],
  kind: Principal['kind'] = 'agent',
): Principal {
  return { id, kind, label: id, transport: 'stdio', grants };
}

export function makeSession(
  options: { document?: Document; executor?: Partial<ExecutorOptions>; principal?: Principal } = {},
): Session {
  let counter = 0;
  const tick = (): number => {
    counter += 1;
    return counter;
  };
  const rng = () => tick().toString(16).padStart(16, '0');
  const authority = new HeadlessAuthority({
    document: options.document ?? createDocument('Test'),
    instanceId: 'test-instance',
    newId: () => `id${tick().toString(16).padStart(10, '0')}`,
  });
  const executor = new Executor({
    catalog: createStandardCatalog(),
    ...options.executor,
  });
  const ctx: ExecutorContext = {
    principal: options.principal ?? ownerPrincipal(),
    authority,
    rng,
  };
  return {
    executor,
    authority,
    ctx,
    run: (command, args, extra) => executor.execute(ctx, { command, args, ...extra }),
    as: (p) => ({ ...ctx, principal: p }),
    doc: () => authority.getDocument(),
  };
}

/** Create a rectangle and return its canonical id. */
export async function addRect(
  session: Session,
  at: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    parentId?: string;
    name?: string;
  } = {},
): Promise<string> {
  const receipt = await session.run('varve.node.create', {
    kind: 'rect',
    x: at.x ?? 0,
    y: at.y ?? 0,
    width: at.width ?? 100,
    height: at.height ?? 50,
    ...(at.parentId ? { parentId: at.parentId } : {}),
    ...(at.name ? { name: at.name } : {}),
  });
  if (receipt.outcome !== 'applied') {
    throw new Error(`addRect failed: ${receipt.summary}`);
  }
  return receipt.created[0] as string;
}

export async function addFrame(
  session: Session,
  at: { x?: number; y?: number; width?: number; height?: number; parentId?: string } = {},
): Promise<string> {
  const receipt = await session.run('varve.node.create', {
    kind: 'frame',
    x: at.x ?? 0,
    y: at.y ?? 0,
    width: at.width ?? 400,
    height: at.height ?? 300,
    ...(at.parentId ? { parentId: at.parentId } : {}),
  });
  if (receipt.outcome !== 'applied') {
    throw new Error(`addFrame failed: ${receipt.summary}`);
  }
  return receipt.created[0] as string;
}
