/**
 * Runtime content identity for raster tile pixel buffers.
 *
 * A tile's persisted `version` counts mutations of one node's tile; it is not a
 * content identity. Undo followed by a different stroke, a divergent-branch
 * checkout, and a replay from the log can all produce two different pixel
 * states that carry the same version number. Any cache that decides "this tile
 * is already resident" from the version alone can then keep showing the wrong
 * pixels.
 *
 * Published tile buffers are immutable (`RasterTileDraft` clones before it
 * writes), so the buffer object itself is the content's identity. This hands
 * out a process-local number per buffer: stable for the buffer's lifetime,
 * never reused for another buffer, and not persisted — it must not enter the
 * canonical document form.
 */

const identities = new WeakMap<object, number>();
let nextIdentity = 1;

export function tilePixelsIdentity(pixels: object): number {
  let id = identities.get(pixels);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(pixels, id);
  }
  return id;
}
