import { CommandCatalog } from '../catalog';
import { CAPTURE_COMMANDS } from './capture';
import { DOCUMENT_COMMANDS } from './document';
import { HISTORY_COMMANDS } from './history';
import { NODE_COMMANDS } from './node';

export {
  CAPTURE_COMMANDS,
  CAPTURE_MAX_DIMENSION,
  CAPTURE_MAX_IMAGE_BYTES,
  captureNode,
} from './capture';
export * from './common';
export { DOCUMENT_COMMANDS } from './document';
export { HISTORY_COMMANDS } from './history';
export { NODE_COMMANDS } from './node';

/** The standard catalog every runtime serves. Validated at construction. */
export function createStandardCatalog(): CommandCatalog {
  const catalog = new CommandCatalog();
  for (const command of [
    ...DOCUMENT_COMMANDS,
    ...NODE_COMMANDS,
    ...HISTORY_COMMANDS,
    ...CAPTURE_COMMANDS,
  ]) {
    catalog.register(command);
  }
  return catalog;
}
