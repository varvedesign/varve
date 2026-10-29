import type { Document } from '../document';
import type { NodeId, SceneNode } from '../types';

/**
 * Keep the font manifest scoped to the transported resource closure. A full
 * document manifest must not leak unrelated font metadata into a clipboard
 * fragment, while legacy family-only entries still need to travel with the
 * text so the receiving document can report the unresolved request honestly.
 */
export function collectFontManifestClosure(
  doc: Document,
  nodes: Record<NodeId, SceneNode>,
  styles: NonNullable<Document['styles']>,
): Document['fontManifest'] | undefined {
  const manifest = doc.fontManifest;
  if (!manifest) return undefined;

  const required = new Set<string>();
  const families = new Set<string>();
  const add = (family: string | undefined, reference: unknown): void => {
    const normalized = family?.trim().toLowerCase();
    if (!normalized) return;
    families.add(normalized);
    if (
      reference &&
      typeof reference === 'object' &&
      typeof (reference as { artifactHash?: unknown }).artifactHash === 'string'
    ) {
      const candidate = reference as { artifactHash: string; collectionIndex?: number };
      required.add(
        `${normalized}\u0000${candidate.artifactHash.toLowerCase()}:${candidate.collectionIndex ?? 'single'}`,
      );
      return;
    }
    required.add(normalized);
  };

  for (const node of Object.values(nodes)) {
    const text = node.kind === 'text' ? node : undefined;
    add(text?.fontFamily, text?.fontReference);
    for (const paragraph of text?.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        add(run.format?.fontFamily, run.format?.fontReference);
      }
    }
  }
  for (const style of Object.values(styles)) {
    const candidate = style as unknown as {
      type?: string;
      fontFamily?: string;
      fontReference?: unknown;
      format?: { fontFamily?: string; fontReference?: unknown };
      characterFormat?: { fontFamily?: string; fontReference?: unknown };
    };
    if (candidate.type === 'text') add(candidate.fontFamily, candidate.fontReference);
    add(candidate.format?.fontFamily, candidate.format?.fontReference);
    add(candidate.characterFormat?.fontFamily, candidate.characterFormat?.fontReference);
  }

  const fonts = manifest.fonts.filter((entry) => {
    const family = entry.familyName.trim().toLowerCase();
    if (!families.has(family)) return false;
    if (!entry.fontReference) return families.has(family);
    return required.has(
      `${family}\u0000${entry.fontReference.artifactHash.toLowerCase()}:${entry.fontReference.collectionIndex ?? 'single'}`,
    );
  });
  if (fonts.length === 0) return undefined;
  const relevantFamilies = new Set(fonts.map((entry) => entry.familyName.toLowerCase()));
  const replacements = manifest.replacements?.filter(
    (replacement) =>
      relevantFamilies.has(replacement.original.toLowerCase()) ||
      relevantFamilies.has(replacement.replacement.toLowerCase()),
  );
  return {
    ...manifest,
    fonts,
    ...(replacements && replacements.length > 0 ? { replacements } : {}),
  };
}
