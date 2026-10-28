import type { NodeId } from './ids';

/** Shared document-level comic workflow defaults. This is advisory metadata,
 * never a separate scene or renderer. */
export type ComicWorkflowProfile = 'comic-print' | 'manga' | 'webtoon-vertical';

export type ComicReadingDirection = 'ltr' | 'rtl';

export type ComicPublishingTarget = 'print' | 'webtoon' | 'both';

export type ComicProductionStatus = 'planned' | 'rough' | 'inked' | 'lettered' | 'finished';

export interface StoryOutlineEntry {
  id: string;
  pageId: NodeId;
  title?: string;
  notes?: string;
  status: ComicProductionStatus;
  /** Explicit panel order, independent of scene paint order. */
  panelIds: NodeId[];
  /** Ordered dialogue story ids, including unplaced stories. */
  dialogueStoryIds: NodeId[];
}

export interface StoryOutline {
  version: 1;
  entries: StoryOutlineEntry[];
  updatedAt?: number;
}
