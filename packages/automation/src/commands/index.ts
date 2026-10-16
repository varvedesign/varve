import { CommandCatalog } from '../catalog';
import { DOCUMENT_COMMANDS } from './document';
import { HISTORY_COMMANDS } from './history';
import { NODE_COMMANDS } from './node';

export * from './common';
export { DOCUMENT_COMMANDS } from './document';
export { HISTORY_COMMANDS } from './history';
export { NODE_COMMANDS } from './node';

/** The standard catalog every runtime serves. Validated at construction. */
export function createStandardCatalog(): CommandCatalog {
  const catalog = new CommandCatalog();
  for (const command of [...DOCUMENT_COMMANDS, ...NODE_COMMANDS, ...HISTORY_COMMANDS]) {
    catalog.register(command);
  }
  return catalog;
}
