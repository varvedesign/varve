/**
 * Verification-harness exporter.
 *
 * Writes a complete web bundle (React + Tailwind component, assets/,
 * regeneration manifest) from the acceptance corpus when
 * VARVE_CODEGEN_VERIFY_OUT points at a directory. The harness scripts in
 * `scripts/codegen-verify/` consume that directory with the real consumer
 * toolchains. Without the variable this test is a no-op.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bytesToDataUrl } from '../bundle-assets';
import { withRegenerationManifest } from '../regeneration';
import { exportNodeToTailwindBundle } from '../tailwind';
import type { RasterAsset } from '../types';
import {
  buildGraphicsShowcaseDoc,
  buildResponsivePageDoc,
  TINY_PNG_DATA_URL,
} from './helpers/corpus';

function requireNode(doc: ReturnType<typeof buildGraphicsShowcaseDoc>['doc'], id: string) {
  const node = doc.nodes[id];
  if (!node) throw new Error(`corpus node ${id} missing`);
  return node;
}

describe('verification harness export', () => {
  it('writes the web bundle when VARVE_CODEGEN_VERIFY_OUT is set', () => {
    const outDir = process.env.VARVE_CODEGEN_VERIFY_OUT;
    if (!outDir) return;
    mkdirSync(outDir, { recursive: true });

    // The graphics showcase carries effects that need a rasterized fallback
    // (blended ellipse over a backdrop), exercising the asset pipeline end
    // to end in the consumer build.
    const g = buildGraphicsShowcaseDoc();
    const rasterAsset: RasterAsset = {
      nodeId: g.blendedCircleId,
      // Stable 1x1 PNG bytes; the harness verifies file resolution, not
      // rasterizer output (that is covered by the export E2E).
      dataUrl: TINY_PNG_DATA_URL,
      pixelWidth: 1,
      pixelHeight: 1,
      cssWidth: 120,
      cssHeight: 120,
    };
    const bundle = withRegenerationManifest(
      exportNodeToTailwindBundle(requireNode(g.doc, g.rootId), g.doc, {
        rasterAssets: { [g.blendedCircleId]: rasterAsset },
        assetMode: 'files',
        componentName: 'Showcase',
        fileStem: 'showcase',
      }),
      { docRevision: g.doc.id ?? 'corpus', optionsFingerprint: 'verify-web' },
    );
    for (const file of bundle.files) {
      const target = join(outDir, file.path);
      mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true });
      writeFileSync(target, file.contents);
    }
    for (const asset of bundle.assets ?? []) {
      const assetPath = join(outDir, asset.path);
      mkdirSync(assetPath.slice(0, assetPath.lastIndexOf('/')), { recursive: true });
      writeFileSync(assetPath, asset.bytes);
    }
    expect(bundle.files.length).toBeGreaterThan(0);

    // And the responsive page corpus for layout coverage.
    const page = buildResponsivePageDoc();
    const pageBundle = withRegenerationManifest(
      exportNodeToTailwindBundle(requireNode(page.doc, page.rootId), page.doc, {
        componentName: 'Page',
        fileStem: 'page',
      }),
      { docRevision: page.doc.id ?? 'corpus', optionsFingerprint: 'verify-web' },
    );
    for (const file of pageBundle.files) {
      writeFileSync(join(outDir, file.path), file.contents);
    }
    void bytesToDataUrl;
  });
});
