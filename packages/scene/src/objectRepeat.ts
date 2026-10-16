import type { Affine, Point } from '@varve/shared';
import { identity, multiplyAffine, rotateDeg, translate, tryInvertAffine } from '@varve/shared';
import type { ObjectRepeat } from './types';

/** Hard safety budget shared by rendering, export, and interactive editing. */
export const MAX_OBJECT_REPEAT_INSTANCES = 512;

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);

const safeCenter = (center: Point): Point => [finite(center?.[0]), finite(center?.[1])];

function around(center: Point, transform: Affine): Affine {
  return multiplyAffine(
    translate(center[0], center[1]),
    multiplyAffine(transform, translate(-center[0], -center[1])),
  );
}

/**
 * Return deterministic source-local transforms, with the authored source at
 * index zero. Malformed values are bounded here so renderers never need to
 * duplicate safety policy and cannot allocate unbounded instance lists.
 */
export function objectRepeatTransforms(repeat: ObjectRepeat): Affine[] {
  if (repeat.type === 'grid') {
    const columns = Math.max(1, Math.min(32, Math.trunc(finite(repeat.columns, 1))));
    const rows = Math.max(1, Math.min(32, Math.trunc(finite(repeat.rows, 1))));
    const result: Affine[] = [];
    for (let row = 0; row < rows && result.length < MAX_OBJECT_REPEAT_INSTANCES; row++) {
      for (
        let column = 0;
        column < columns && result.length < MAX_OBJECT_REPEAT_INSTANCES;
        column++
      ) {
        result.push(translate(finite(repeat.spacingX) * column, finite(repeat.spacingY) * row));
      }
    }
    return result.length > 0 ? result : [identity];
  }

  if (repeat.type === 'radial') {
    const copies = Math.max(
      1,
      Math.min(MAX_OBJECT_REPEAT_INSTANCES, Math.trunc(finite(repeat.copies, 1))),
    );
    const sweep = finite(repeat.sweep, 360);
    const center = safeCenter(repeat.center);
    const fullTurn = Math.abs(sweep) >= 360;
    const denominator = fullTurn ? copies : Math.max(1, copies - 1);
    return Array.from({ length: copies }, (_, index) =>
      around(center, rotateDeg((sweep * index) / denominator)),
    );
  }

  const center = safeCenter(repeat.center);
  const result: Affine[] = [identity];
  const horizontal = repeat.horizontal === true;
  const vertical = repeat.vertical === true;
  if (horizontal) result.push(around(center, [-1, 0, 0, 1, 0, 0]));
  if (vertical) result.push(around(center, [1, 0, 0, -1, 0, 0]));
  if (horizontal && vertical) result.push(around(center, [-1, 0, 0, -1, 0, 0]));
  return result;
}

/**
 * Lift source-local repeat transforms into world space while preserving the
 * group's authored world transform. Returns the source-only identity for a
 * singular group transform, where a local repeat cannot be projected safely.
 */
export function objectRepeatWorldTransforms(repeat: ObjectRepeat, groupWorld: Affine): Affine[] {
  const inverse = tryInvertAffine(groupWorld);
  if (!inverse) return [identity];
  return objectRepeatTransforms(repeat).map((local) =>
    multiplyAffine(groupWorld, multiplyAffine(local, inverse)),
  );
}
