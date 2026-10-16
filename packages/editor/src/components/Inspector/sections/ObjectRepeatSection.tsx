import type { GroupNode, ObjectRepeat } from '@varve/scene';
import type { Point } from '@varve/shared';
import { Button, Select } from '@varve/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { expandObjectRepeat, releaseObjectRepeat } from '../../../scene/objectRepeatExpansion';
import { sourceLocalBounds } from '../../../scene/objectRepeatGeometry';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SectionId } from '../sectionRegistry';

const MODE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'grid', label: 'Grid' },
  { value: 'radial', label: 'Radial' },
  { value: 'mirror', label: 'Mirror' },
];

function defaultRepeat(type: ObjectRepeat['type'], center: Point): ObjectRepeat {
  if (type === 'grid') return { type, columns: 2, rows: 1, spacingX: 120, spacingY: 0 };
  if (type === 'radial') return { type, copies: 8, center, sweep: 360 };
  return { type: 'mirror', horizontal: true, vertical: false, center };
}

/** Inspector controls for a live repeated group; source children stay editable. */
export function ObjectRepeatSection({
  node,
  sectionId,
}: {
  node: GroupNode;
  sectionId?: SectionId;
}) {
  const editor = useEditor();
  const repeat = node.objectRepeat;
  const summary = repeat
    ? repeat.type === 'grid'
      ? `${repeat.columns} by ${repeat.rows}`
      : repeat.type === 'radial'
        ? `${repeat.copies} instances`
        : 'Reflections'
    : 'Off';

  const updateRepeat = useCallback(
    (next: ObjectRepeat | undefined) => {
      editor.groupCompoundOperation('Edit live repeat', () => {
        editor.updateNode(node.id, (current) =>
          current.kind === 'group' ? { ...current, objectRepeat: next } : current,
        );
      });
    },
    [editor, node.id],
  );

  const patchRepeat = (patch: Partial<ObjectRepeat>) => {
    if (!repeat) return;
    updateRepeat({ ...repeat, ...patch } as ObjectRepeat);
  };

  return (
    <DisclosureSection title="Live repeat" sectionId={sectionId} summary={summary}>
      <p className="insp-hint">
        Repeated artwork stays linked to these group contents. Edit the source inside the group to
        update every instance.
      </p>
      <FieldRow label="Arrangement">
        <Select
          label="Repeat arrangement"
          value={repeat?.type ?? 'none'}
          options={MODE_OPTIONS}
          onChange={(value) => {
            if (value === 'none') updateRepeat(undefined);
            else {
              const bounds = sourceLocalBounds(
                editor.state.document,
                node,
                editor.getWorldTransform,
              );
              const center: Point = bounds
                ? [bounds.x + bounds.w / 2, bounds.y + bounds.h / 2]
                : [0, 0];
              updateRepeat(
                repeat?.type === value
                  ? repeat
                  : defaultRepeat(value as ObjectRepeat['type'], center),
              );
            }
          }}
        />
      </FieldRow>

      {repeat?.type === 'grid' && (
        <>
          <NumberField
            label="Columns"
            value={repeat.columns}
            min={1}
            max={32}
            step={1}
            onChange={(columns) => patchRepeat({ columns })}
          />
          <NumberField
            label="Rows"
            value={repeat.rows}
            min={1}
            max={32}
            step={1}
            onChange={(rows) => patchRepeat({ rows })}
          />
          <NumberField
            label="Horizontal spacing"
            unit="px"
            value={repeat.spacingX}
            step={1}
            onChange={(spacingX) => patchRepeat({ spacingX })}
          />
          <NumberField
            label="Vertical spacing"
            unit="px"
            value={repeat.spacingY}
            step={1}
            onChange={(spacingY) => patchRepeat({ spacingY })}
          />
        </>
      )}

      {repeat?.type === 'radial' && (
        <>
          <NumberField
            label="Instances"
            value={repeat.copies}
            min={1}
            max={512}
            step={1}
            onChange={(copies) => patchRepeat({ copies })}
          />
          <NumberField
            label="Sweep"
            unit="°"
            value={repeat.sweep}
            min={-360}
            max={360}
            onChange={(sweep) => patchRepeat({ sweep })}
          />
          <NumberField
            label="Center X"
            unit="px"
            value={repeat.center[0]}
            onChange={(x) => patchRepeat({ center: [x, repeat.center[1]] })}
          />
          <NumberField
            label="Center Y"
            unit="px"
            value={repeat.center[1]}
            onChange={(y) => patchRepeat({ center: [repeat.center[0], y] })}
          />
        </>
      )}

      {repeat?.type === 'mirror' && (
        <>
          <FieldRow label="Axes">
            <fieldset aria-label="Mirror axes">
              <Button
                variant={repeat.horizontal ? 'secondary' : 'ghost'}
                aria-pressed={repeat.horizontal}
                onClick={() => patchRepeat({ horizontal: !repeat.horizontal })}
              >
                Vertical axis
              </Button>
              <Button
                variant={repeat.vertical ? 'secondary' : 'ghost'}
                aria-pressed={repeat.vertical}
                onClick={() => patchRepeat({ vertical: !repeat.vertical })}
              >
                Horizontal axis
              </Button>
            </fieldset>
          </FieldRow>
          <NumberField
            label="Center X"
            unit="px"
            value={repeat.center[0]}
            onChange={(x) => patchRepeat({ center: [x, repeat.center[1]] })}
          />
          <NumberField
            label="Center Y"
            unit="px"
            value={repeat.center[1]}
            onChange={(y) => patchRepeat({ center: [repeat.center[0], y] })}
          />
        </>
      )}

      {repeat && (
        <FieldRow label="Lifecycle">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              editor.groupCompoundOperation('Release live repeat', () => {
                editor.updateDoc((document) => releaseObjectRepeat(document, node.id));
              });
              editor.showToast({
                message: 'Repeat released; only the authored source remains.',
                type: 'success',
              });
            }}
          >
            Release to source
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              let generatedCount = 0;
              try {
                editor.groupCompoundOperation('Expand live repeat', () => {
                  editor.updateDoc((document) => {
                    const expanded = expandObjectRepeat(document, node.id);
                    generatedCount = expanded.generatedRootIds.length;
                    return expanded.document;
                  });
                });
                editor.showToast({
                  message: `Repeat expanded into ${generatedCount} independent object(s).`,
                  type: 'success',
                });
              } catch (error) {
                editor.showToast({
                  message: error instanceof Error ? error.message : 'Could not expand this repeat.',
                  type: 'error',
                });
              }
            }}
          >
            Expand copies
          </Button>
        </FieldRow>
      )}
    </DisclosureSection>
  );
}
