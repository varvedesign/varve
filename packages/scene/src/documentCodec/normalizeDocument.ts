import { normalizeAdjustmentStack } from '../adjustmentNormalization';
import type { Document } from '../document';
import { isContainer, makeGroupNode } from '../document';
import { traversalChildren } from '../document-utils';
import { normalizeEffectLooks } from '../effectLooks';
import { normalizeDocumentEffects } from '../effects';
import { normalizeGenerativeEdits } from '../generativeEdit';
import { normalizeLogoProject } from '../logo/logoProject';
import { sanitizeMockupState } from '../mockup/normalize';
import { validatePatternDefinitionDependencies } from '../patternDefinitions';
import { normalizePresentationMetadata } from '../presentation/normalize';
import { normalizeSavedAreaSelections } from '../savedAreaSelection';
import { createEmptySelectionSetsData } from '../selectionSet';
import { normalizeStrokeIds } from '../strokeIdentity';
import { emptyTableModel } from '../table';
import { normalizeTableModelDefensively } from '../tableOps';
import type { NodeId, Page, SceneNode } from '../types';
import { normalizeConceptArtReferenceMetadata } from '../types';
import {
  CURRENT_DOCUMENT_VERSION,
  normalizeLayerColors,
  normalizeLegacyBackgroundRemoval,
} from '../version';
import {
  normalizeImageFillGeometry,
  normalizeInlineImageFills,
  sanitizeIconAssetState,
  sanitizeImageAssetState,
} from './assetMigrations';
import {
  hasImageFill,
  sanitizeRasterMaskState,
  sanitizeStructuralMaskState,
} from './maskMigrations';
import {
  normalizeRasterTiles,
  validatePhotoSourceState,
  validateRetouchProvenanceState,
} from './nodeMigrations';
import type { DocumentNormalizeResult } from './types';
import {
  isRecord,
  malformedLegacyBackgroundRemovalWarnings,
  maxNumericNodeId,
  warning,
} from './validation';

export function normalizeDocument(doc: Document): DocumentNormalizeResult {
  const warnings = malformedLegacyBackgroundRemovalWarnings(
    doc as unknown as Record<string, unknown>,
  );
  const safeNodes: Record<NodeId, SceneNode> = {};
  for (const [nodeId, node] of Object.entries(doc.nodes ?? {}) as [string, unknown][]) {
    if (isRecord(node)) {
      safeNodes[nodeId] = node as unknown as SceneNode;
    } else {
      warnings.push(
        warning(
          'document.invalid-node',
          `Document node ${nodeId} was not an object and was removed`,
          'error',
          `nodes.${nodeId}`,
        ),
      );
    }
  }
  doc = { ...doc, nodes: safeNodes };
  doc = normalizeLayerColors(doc as unknown as Record<string, unknown>) as unknown as Document;
  doc = normalizeLegacyBackgroundRemoval(
    doc as unknown as Record<string, unknown>,
  ) as unknown as Document;
  const nodes: Record<NodeId, SceneNode> = {};

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!node || node.id !== id) {
      warnings.push(
        warning('document.node-id-normalized', `Node ${id} had a mismatched id`, 'warning', id),
      );
    }

    let nodeWithStrokeIds =
      'strokes' in node
        ? ({
            ...node,
            strokes: normalizeStrokeIds(
              id,
              (node as SceneNode & { strokes?: import('../types').Stroke[] }).strokes,
            ),
          } as SceneNode)
        : node;

    if ('conceptArtReference' in nodeWithStrokeIds) {
      const normalizedReference = hasImageFill(doc, nodeWithStrokeIds)
        ? normalizeConceptArtReferenceMetadata(
            (nodeWithStrokeIds as { conceptArtReference?: unknown }).conceptArtReference,
          )
        : undefined;
      if (normalizedReference) {
        nodeWithStrokeIds = { ...nodeWithStrokeIds, conceptArtReference: normalizedReference };
      } else {
        const { conceptArtReference: _discarded, ...withoutReference } = nodeWithStrokeIds as
          | (SceneNode & { conceptArtReference?: unknown })
          | (Record<string, unknown> & { conceptArtReference?: unknown });
        nodeWithStrokeIds = withoutReference as SceneNode;
        warnings.push(
          warning(
            'document.invalid-concept-art-reference',
            `Reference metadata on node ${id} was invalid or the node was not an image shape; it was removed`,
            'warning',
            `${id}.conceptArtReference`,
          ),
        );
      }
    }

    const rawChildren = (nodeWithStrokeIds as { children?: unknown }).children;
    if (isContainer(nodeWithStrokeIds) || Array.isArray(rawChildren)) {
      const children: NodeId[] = [];
      for (const childId of traversalChildren(nodeWithStrokeIds)) {
        if (doc.nodes[childId]) {
          children.push(childId);
        } else {
          warnings.push(
            warning(
              'document.orphan-child',
              `Container ${id} referenced missing child ${childId}`,
              'warning',
              `${id}.children`,
            ),
          );
        }
      }
      nodes[id] = { ...nodeWithStrokeIds, id, children } as SceneNode;
    } else if (nodeWithStrokeIds.kind === 'table') {
      // Tables carry embedded models that must satisfy span invariants on
      // load; repair defensively instead of trusting serialized data.
      const tableNode = nodeWithStrokeIds as unknown as Record<string, unknown>;
      const tableRaw = tableNode.table;
      const { model, issues } = normalizeTableModelDefensively(tableRaw);
      if (!model) {
        warnings.push(
          warning(
            'document.invalid-table',
            `Table node ${id} has no valid table model`,
            'warning',
            id,
          ),
        );
        nodes[id] = { ...nodeWithStrokeIds, id, table: emptyTableModel() } as SceneNode;
      } else {
        if (issues.length > 0) {
          warnings.push(
            warning(
              'document.table-repaired',
              `Table node ${id} was repaired (${issues.length} issue(s))`,
              'warning',
              `${id}.table`,
            ),
          );
        }
        nodes[id] = { ...nodeWithStrokeIds, id, table: model } as SceneNode;
      }
    } else {
      nodes[id] = normalizeRasterTiles(id, { ...nodeWithStrokeIds, id } as SceneNode, warnings);
    }
  }

  const rootChildren: NodeId[] = [];
  for (const rootId of doc.rootChildren) {
    if (nodes[rootId]) {
      rootChildren.push(rootId);
    } else {
      warnings.push(
        warning('document.orphan-root', `Root referenced missing node ${rootId}`, 'warning'),
      );
    }
  }

  let pages: Page[] | undefined;
  if (doc.pages) {
    pages = [];
    for (const page of doc.pages) {
      if (!nodes[page.contentRoot]) {
        nodes[page.contentRoot] = makeGroupNode(page.contentRoot, {
          name: `${page.name} content`,
          children: [],
        });
        warnings.push(
          warning(
            'document.page-content-root-missing',
            `Page ${page.id} referenced missing content root ${page.contentRoot}; an empty content root was created`,
            'warning',
            `pages.${page.id}.contentRoot`,
          ),
        );
      }

      const backgrounds: NodeId[] = [];
      for (const backgroundId of page.backgrounds) {
        if (nodes[backgroundId]) {
          backgrounds.push(backgroundId);
        } else {
          warnings.push(
            warning(
              'document.page-background-missing',
              `Page ${page.id} referenced missing background ${backgroundId}`,
              'warning',
              `pages.${page.id}.backgrounds`,
            ),
          );
        }
      }

      pages.push({ ...page, backgrounds });
      if (!rootChildren.includes(page.contentRoot)) {
        rootChildren.push(page.contentRoot);
        warnings.push(
          warning(
            'document.page-content-root-rooted',
            `Page ${page.id} content root ${page.contentRoot} was restored to rootChildren`,
            'warning',
            `pages.${page.id}.contentRoot`,
          ),
        );
      }
    }
  }

  const activePageId =
    pages && pages.length > 0
      ? pages.some((page) => page.id === doc.activePageId)
        ? doc.activePageId
        : pages[0]?.id
      : undefined;
  if (doc.activePageId !== activePageId) {
    warnings.push(
      warning(
        'document.active-page-normalized',
        activePageId
          ? `Active page normalized to ${activePageId}`
          : 'Active page cleared because the document has no valid pages',
        'warning',
        'activePageId',
      ),
    );
  }

  const minNextId = maxNumericNodeId(nodes) + 1;
  const nextId = Math.max(doc.nextId, minNextId, 1);

  let document: Document = {
    ...doc,
    formatVersion: CURRENT_DOCUMENT_VERSION,
    rootChildren,
    nodes,
    nextId,
    components: doc.components ?? {},
    patternDefinitions: doc.patternDefinitions ?? {},
    pages,
    activePageId,
  };
  const patternGraphErrors = validatePatternDefinitionDependencies(
    document.patternDefinitions ?? {},
    document,
  );
  for (const message of patternGraphErrors) {
    warnings.push(
      warning('document.invalid-pattern-dependency', message, 'warning', 'patternDefinitions'),
    );
  }
  document = normalizeImageFillGeometry(document);
  document = normalizeInlineImageFills(document, warnings);
  document = sanitizeStructuralMaskState(document, warnings);
  document = sanitizeRasterMaskState(document, warnings);
  document = sanitizeImageAssetState(document, warnings);
  document = validatePhotoSourceState(document, warnings);
  document = validateRetouchProvenanceState(document, warnings);
  document = sanitizeIconAssetState(document, warnings);
  document = sanitizeMockupState(document, warnings);
  document = normalizeDocumentEffects(document);
  document = { ...document, generativeEdits: normalizeGenerativeEdits(document.generativeEdits) };

  const savedSelections = normalizeSavedAreaSelections(document.savedAreaSelections);
  document = { ...document, savedAreaSelections: savedSelections.selections };
  if (savedSelections.dropped > 0) {
    warnings.push(
      warning(
        'document.invalid-saved-selection',
        `Dropped ${savedSelections.dropped} malformed saved area selection${savedSelections.dropped === 1 ? '' : 's'}`,
        'warning',
        'savedAreaSelections',
      ),
    );
  }

  // Adjustment and object-local filter entries share the engine's FilterIR
  // contract, but they are still persisted scene data and need the same
  // defensive normalization as legacy visual effects. Without this pass a
  // malformed NaN/Infinity value can reach a kernel or a raster allocation.
  const normalizedNodes: Record<NodeId, SceneNode> = {};
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    let nextNode = node;
    if (node.kind === 'adjustment' && node.adjustments !== undefined) {
      const result = normalizeAdjustmentStack(node.adjustments, nodeId);
      if (result.changed) {
        nextNode = { ...nextNode, adjustments: result.adjustments } as SceneNode;
      }
      if (result.dropped > 0) {
        warnings.push(
          warning(
            'document.invalid-adjustment',
            `Adjustment layer ${nodeId} dropped ${result.dropped} malformed filter entr${result.dropped === 1 ? 'y' : 'ies'}`,
            'warning',
            `${nodeId}.adjustments`,
          ),
        );
      }
      if (result.unknown > 0) {
        warnings.push(
          warning(
            'document.unknown-adjustment',
            `Adjustment layer ${nodeId} preserved ${result.unknown} unsupported filter entr${result.unknown === 1 ? 'y' : 'ies'} as pass-through content`,
            'info',
            `${nodeId}.adjustments`,
          ),
        );
      }
    }
    if (nextNode.smartFilters !== undefined) {
      const result = normalizeAdjustmentStack(nextNode.smartFilters, nodeId);
      if (result.changed) {
        nextNode = { ...nextNode, smartFilters: result.adjustments } as SceneNode;
      }
      if (result.dropped > 0) {
        warnings.push(
          warning(
            'document.invalid-smart-filter',
            `Object filter stack on ${nodeId} dropped ${result.dropped} malformed filter entr${result.dropped === 1 ? 'y' : 'ies'}`,
            'warning',
            `${nodeId}.smartFilters`,
          ),
        );
      }
      if (result.unknown > 0) {
        warnings.push(
          warning(
            'document.unknown-smart-filter',
            `Object Filter stack on ${nodeId} preserved ${result.unknown} unsupported filter entr${result.unknown === 1 ? 'y' : 'ies'} as pass-through content`,
            'info',
            `${nodeId}.smartFilters`,
          ),
        );
      }
    }
    normalizedNodes[nodeId] = nextNode;
  }
  document = { ...document, nodes: normalizedNodes };
  const effectLooks = normalizeEffectLooks(document.effectLooks);
  if (effectLooks !== undefined) document = { ...document, effectLooks };
  if (!document.selectionSets) {
    document = { ...document, selectionSets: createEmptySelectionSetsData() };
  }
  if (document.logoProject !== undefined) {
    document = { ...document, logoProject: normalizeLogoProject(document.logoProject) };
  }
  if (document.presentation !== undefined) {
    const presentation = normalizePresentationMetadata(document.presentation);
    if (presentation) document = { ...document, presentation };
  }
  return { document, warnings };
}
