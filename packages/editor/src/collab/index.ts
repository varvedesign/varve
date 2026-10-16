/**
 * Editor collaboration integration (ADR-0200). Public surface for Shell:
 * the session provider and every presence surface. A single barrel keeps
 * hub-file import budgets neutral (Shell swaps two collab imports for one).
 */

export type {
  CollabNoticeEntry,
  CollabSessionConfig,
  CollabSessionValue,
} from './CollabSessionContext';
export { CollabSessionProvider, useCollabSession } from './CollabSessionContext';
export {
  CollabCanvasPresence,
  CollabHeaderControl,
  CollabLayersPresence,
  CollabNotices,
} from './CollabSurfaces';
export { ShareDialog } from './ShareDialog';
