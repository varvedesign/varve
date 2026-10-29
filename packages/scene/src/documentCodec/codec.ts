import type { Document } from '../document';
import type { DocumentLike } from '../document-utils';
import { findParentCycle, validateAndRepairDocument } from '../document-utils';
import { validateRasterMaskDocument } from '../masks';
import { validatePatternDefinitionDependencies } from '../patternDefinitions';
import {
  migrateDocumentDetailed,
  serializeDocument as serializeVersionedDocument,
} from '../version';
import { collectNodeClosure } from './closure';
import { normalizeDocument } from './normalizeDocument';
import type { DocumentDecodeResult } from './types';
import {
  isRecord,
  malformedLegacyBackgroundRemovalWarnings,
  unrecognizedVersionWarnings,
  validateRuntimeCollections,
  validateShape,
  warning,
} from './validation';

export const DocumentCodec = {
  decode(json: string): DocumentDecodeResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON',
        warnings: [warning('document.invalid-json', 'Document JSON could not be parsed', 'error')],
      };
    }

    const legacyWarnings = isRecord(parsed) ? malformedLegacyBackgroundRemovalWarnings(parsed) : [];
    const versionWarnings = isRecord(parsed) ? unrecognizedVersionWarnings(parsed) : [];

    if (isRecord(parsed)) {
      const runtimeError = validateRuntimeCollections(parsed);
      if (runtimeError) {
        return {
          ok: false,
          error: runtimeError,
          warnings: [warning('document.invalid-shape', runtimeError, 'error')],
        };
      }
    }

    // The migration table reads fields of bytes we did not write. A throw here
    // would escape the codec's result contract entirely, so an unforeseeable
    // input shape fails this document instead of the open path.
    let migration: ReturnType<typeof migrateDocumentDetailed>;
    try {
      migration = migrateDocumentDetailed(parsed);
    } catch (error) {
      const message = `Document migration failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`;
      return {
        ok: false,
        error: message,
        warnings: [warning('document.migration-failed', message, 'error')],
      };
    }
    if (!migration) {
      return {
        ok: false,
        error: 'Document payload was not an object',
        warnings: [
          warning('document.invalid-shape', 'Document payload was not an object', 'error'),
        ],
      };
    }

    const shapeError = validateShape(migration.document);
    if (shapeError) {
      return {
        ok: false,
        error: shapeError,
        warnings: [warning('document.invalid-shape', shapeError, 'error')],
      };
    }

    // Parent-graph cycle guard: world-transform composition, render walks,
    // and hit testing must never loop forever on a corrupt document.
    const cycle = findParentCycle(migration.document as unknown as DocumentLike);
    if (cycle) {
      const errorMessage = `Document contains a parent cycle: ${cycle.join(' -> ')}`;
      return {
        ok: false,
        error: errorMessage,
        warnings: [warning('document.parent-cycle', errorMessage, 'error')],
      };
    }

    // A recursive pattern source can recurse through a vector motif or a
    // component master without creating a parent-graph cycle. Reject it at
    // the document boundary before preview, replay, or clipboard traversal.
    let patternGraphErrors: string[];
    try {
      const candidate = migration.document as unknown as Document;
      patternGraphErrors = validatePatternDefinitionDependencies(
        candidate.patternDefinitions ?? {},
        candidate,
      );
    } catch (error) {
      patternGraphErrors = [
        `Invalid pattern definitions: ${error instanceof Error ? error.message : 'unknown error'}`,
      ];
    }
    if (patternGraphErrors.length > 0) {
      const errorMessage = patternGraphErrors[0]!;
      return {
        ok: false,
        error: errorMessage,
        warnings: [
          warning(
            'document.invalid-pattern-dependency',
            errorMessage,
            'error',
            'patternDefinitions',
          ),
        ],
      };
    }

    let maskError: string | null;
    try {
      maskError = validateRasterMaskDocument(migration.document as unknown as Document);
    } catch (error) {
      maskError = `Invalid raster mask structure: ${error instanceof Error ? error.message : 'unknown validation error'}`;
    }
    if (maskError) {
      return {
        ok: false,
        error: maskError,
        warnings: [warning('document.invalid-raster-mask', maskError, 'error')],
      };
    }

    const normalized = normalizeDocument(migration.document as unknown as Document);
    const warnings = [...normalized.warnings];
    for (const legacyWarning of legacyWarnings) {
      if (
        !warnings.some(
          (item) => item.code === legacyWarning.code && item.path === legacyWarning.path,
        )
      ) {
        warnings.push(legacyWarning);
      }
    }
    if (migration.migrated) {
      warnings.unshift(
        warning(
          'document.migrated',
          `Document migrated from ${migration.fromVersion} to ${migration.toVersion}`,
          'info',
        ),
      );
    }
    warnings.unshift(
      ...migration.warnings.map((message) =>
        warning('document.forward-compatibility', message, 'warning'),
      ),
    );
    warnings.unshift(...versionWarnings);

    const repaired = validateAndRepairDocument(normalized.document);
    if (repaired.repaired.changed) {
      warnings.unshift(
        warning('document.repaired', 'Document references were repaired at load time', 'warning'),
      );
    }

    return { ok: true, document: repaired.repaired.doc as Document, warnings };
  },

  encode(doc: Document): string {
    const patternGraphError = validatePatternDefinitionDependencies(
      doc.patternDefinitions ?? {},
      doc,
    )[0];
    if (patternGraphError) throw new Error(patternGraphError);
    return serializeVersionedDocument(normalizeDocument(doc).document);
  },

  normalize: normalizeDocument,
  collectNodeClosure,
};
