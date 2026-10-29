import type { ManagedColor, SceneNode, TextFrameStyle, TextNode } from '@varve/scene';
import { Switch } from '@varve/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';

const DEFAULT_FRAME_FILL: ManagedColor = { space: 'rgb', r: 255, g: 255, b: 255, a: 255 };
const DEFAULT_FRAME_BORDER: ManagedColor = { space: 'rgb', r: 35, g: 42, b: 52, a: 255 };

export function TextFrameSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const textNodes = nodes.filter((node): node is TextNode => node.kind === 'text');
  const fillValue = commonValue(nodes, (node) =>
    node.kind === 'text' ? node.textFrame?.fill : undefined,
  );
  const borderColor = commonValue(nodes, (node) =>
    node.kind === 'text' ? node.textFrame?.border?.color : undefined,
  );
  const borderWidth = commonValue(nodes, (node) =>
    node.kind === 'text' ? node.textFrame?.border?.width : undefined,
  );
  const fillEnabled = textNodes.length > 0 && textNodes.every((node) => node.textFrame?.fill);
  const borderEnabled = textNodes.length > 0 && textNodes.every((node) => node.textFrame?.border);

  const edit = useCallback(
    (update: (node: TextNode) => TextNode) => {
      for (const node of textNodes)
        editor.updateNode(node.id, (current) => update(current as TextNode));
    },
    [editor, textNodes],
  );
  const change = useCallback(
    (label: string, update: (node: TextNode) => TextNode) =>
      editor.groupCompoundOperation(label, () => edit(update)),
    [editor.groupCompoundOperation, edit],
  );

  return (
    <DisclosureSection title="Text Frame" sectionId="text-frame">
      <FieldRow label="Background">
        <div className="insp-paint-row">
          <Switch
            className="insp-switch"
            aria-label={`${fillEnabled ? 'Remove' : 'Add'} text frame background`}
            checked={fillEnabled}
            onChange={() =>
              change('Edit text frame background', (node) => {
                const frame: TextFrameStyle = { ...node.textFrame };
                if (fillEnabled) delete frame.fill;
                else frame.fill = node.textFrame?.fill ?? DEFAULT_FRAME_FILL;
                return { ...node, textFrame: frame.fill || frame.border ? frame : undefined };
              })
            }
          />
          {fillEnabled && (isMixed(fillValue) || fillValue !== undefined) && (
            <InspectorColorPopover
              label="Text frame background colour"
              value={
                isMixed(fillValue)
                  ? (textNodes[0]?.textFrame?.fill ?? DEFAULT_FRAME_FILL)
                  : fillValue
              }
              valueText={isMixed(fillValue) ? 'Mixed' : undefined}
              swatchStyle={
                isMixed(fillValue)
                  ? {
                      background: 'var(--color-surface-sunken)',
                      border: '2px solid var(--color-border-strong)',
                    }
                  : undefined
              }
              onChange={(color) =>
                change('Edit text frame background', (node) => ({
                  ...node,
                  textFrame: { ...node.textFrame, fill: color },
                }))
              }
              onEditStart={editor.beginTransaction}
              onEditEnd={editor.commitTransaction}
              documentColorMode={editor.documentColorMode}
            />
          )}
        </div>
      </FieldRow>
      <FieldRow label="Border">
        <div className="insp-paint-row">
          <Switch
            className="insp-switch"
            aria-label={`${borderEnabled ? 'Remove' : 'Add'} text frame border`}
            checked={borderEnabled}
            onChange={() =>
              change('Edit text frame border', (node) => {
                const frame: TextFrameStyle = { ...node.textFrame };
                if (borderEnabled) delete frame.border;
                else
                  frame.border = node.textFrame?.border ?? {
                    color: DEFAULT_FRAME_BORDER,
                    width: 1,
                  };
                return { ...node, textFrame: frame.fill || frame.border ? frame : undefined };
              })
            }
          />
          {borderEnabled && (isMixed(borderColor) || borderColor !== undefined) && (
            <InspectorColorPopover
              label="Text frame border colour"
              value={
                isMixed(borderColor)
                  ? (textNodes[0]?.textFrame?.border?.color ?? DEFAULT_FRAME_BORDER)
                  : borderColor
              }
              valueText={isMixed(borderColor) ? 'Mixed' : undefined}
              swatchStyle={
                isMixed(borderColor)
                  ? {
                      background: 'var(--color-surface-sunken)',
                      border: '2px solid var(--color-border-strong)',
                    }
                  : undefined
              }
              onChange={(color) =>
                change('Edit text frame border', (node) => ({
                  ...node,
                  textFrame: {
                    ...node.textFrame,
                    border: { color, width: node.textFrame?.border?.width ?? 1 },
                  },
                }))
              }
              onEditStart={editor.beginTransaction}
              onEditEnd={editor.commitTransaction}
              documentColorMode={editor.documentColorMode}
            />
          )}
        </div>
      </FieldRow>
      {borderEnabled && (
        <NumberField
          label="Border width"
          value={isMixed(borderWidth) || borderWidth === undefined ? 0 : borderWidth}
          mixed={isMixed(borderWidth)}
          min={0}
          max={64}
          step={0.5}
          unit="px"
          onChange={(width) =>
            change('Edit text frame border width', (node) => ({
              ...node,
              textFrame: {
                ...node.textFrame,
                border: {
                  color: node.textFrame?.border?.color ?? DEFAULT_FRAME_BORDER,
                  width: Math.max(0, width),
                },
              },
            }))
          }
          onCommit={(width) =>
            change('Edit text frame border width', (node) => ({
              ...node,
              textFrame: {
                ...node.textFrame,
                border: {
                  color: node.textFrame?.border?.color ?? DEFAULT_FRAME_BORDER,
                  width: Math.max(0, width),
                },
              },
            }))
          }
        />
      )}
    </DisclosureSection>
  );
}
