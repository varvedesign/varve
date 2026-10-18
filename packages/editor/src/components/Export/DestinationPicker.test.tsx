// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DestinationPicker } from './DestinationPicker';

afterEach(cleanup);

function makeJob() {
  return {
    presetId: 'p1',
    nodeId: 'n1',
    nodeName: 'Rect',
    format: 'png' as const,
    fileName: 'rect.png',
    scale: { type: 'factor' as const, value: 2 },
    suffix: '@2x',
    dimensions: { w: 100, h: 80 },
    estimatedSize: 51200,
    status: 'pending' as const,
  };
}

describe('DestinationPicker', () => {
  it('filename template preview', () => {
    render(
      <DestinationPicker
        template="{name}{suffix}.{ext}"
        folderRule="flat"
        conflictPolicy="keep-both"
        jobs={[makeJob()]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onConflictPolicyChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
      />,
    );
    expect(screen.getByText('Rect@2x.png')).toBeTruthy();
    expect(screen.queryByText(/p1/)).toBeNull();
  });

  it('shows select folder button', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        conflictPolicy="keep-both"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onConflictPolicyChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
      />,
    );
    expect(screen.getByText('Select folder\u2026')).toBeTruthy();
  });

  it('shows destination label when set', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        conflictPolicy="keep-both"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onConflictPolicyChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel="/exports"
      />,
    );
    expect(screen.getByText('/exports')).toBeTruthy();
  });

  it('renders folder rule buttons', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        conflictPolicy="keep-both"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onConflictPolicyChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
      />,
    );
    expect(screen.getByText('Flat')).toBeTruthy();
    expect(screen.getByText('By format')).toBeTruthy();
    expect(screen.getByText('By node')).toBeTruthy();
  });

  it('defaults to keeping both and lets users choose replace or skip', () => {
    const onConflictPolicyChange = vi.fn();
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        conflictPolicy="keep-both"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onConflictPolicyChange={onConflictPolicyChange}
        onSelectDestination={() => {}}
        destinationLabel="/exports"
      />,
    );

    expect(screen.getByRole('group', { name: 'Existing files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep both' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(onConflictPolicyChange).toHaveBeenCalledWith('replace');
    fireEvent.click(screen.getByRole('button', { name: 'Skip existing' }));
    expect(onConflictPolicyChange).toHaveBeenCalledWith('skip');
  });

  it('explains archive delivery when direct folder selection is unavailable', () => {
    render(
      <DestinationPicker
        template="{name}.{ext}"
        folderRule="flat"
        conflictPolicy="keep-both"
        jobs={[]}
        onTemplateChange={() => {}}
        onFolderRuleChange={() => {}}
        onConflictPolicyChange={() => {}}
        onSelectDestination={() => {}}
        destinationLabel=""
        folderSelectionAvailable={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Browser download' })).toBeDisabled();
    expect(screen.getByText('Multi-file exports download as one ZIP archive.')).toBeTruthy();
  });
});
