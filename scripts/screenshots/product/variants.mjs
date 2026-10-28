/**
 * WebP/AVIF encoding is optional for metadata-only CLI paths. Isolated
 * capture-safety fixtures copy this file without `variants.mjs`, and
 * pipeline-validate runners do not install ffmpeg. A missing module or
 * encoder must not fail `--normalize` / `--sync-reviewed`.
 */
export async function loadVariantModule() {
  try {
    return await import(new URL('../variants.mjs', import.meta.url));
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_MODULE_NOT_FOUND'
    ) {
      return null;
    }
    throw error;
  }
}

export function skipVariantWrite(reason) {
  console.warn(`skipping screenshot variants (${reason})`);
}

export async function openVariantSupport() {
  const variants = await loadVariantModule();
  if (!variants) {
    skipVariantWrite('variants.mjs not present');
    return {
      writeSceneVariants: async () => undefined,
      removeSceneVariants: () => {},
      close: async () => {},
    };
  }
  const encoder = await variants.createVariantEncoder({ required: false });
  if (!encoder) {
    skipVariantWrite('ffmpeg not available');
    return {
      writeSceneVariants: async () => undefined,
      removeSceneVariants: variants.removeSceneVariants,
      close: async () => {},
    };
  }
  return {
    writeSceneVariants: (scene, bytes, dirs) =>
      variants.writeSceneVariants(scene, bytes, dirs, encoder),
    removeSceneVariants: variants.removeSceneVariants,
    close: () => encoder.close(),
  };
}
