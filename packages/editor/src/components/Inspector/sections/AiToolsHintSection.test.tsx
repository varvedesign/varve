// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { notifyAiFeaturesSettingsChanged } from '@varve/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { AiToolsHintSection } from './AiToolsHintSection';

function ModeReadout() {
  const { state } = useEditor();
  return <span data-testid="mode-readout">{state.workspaceMode}</span>;
}

function expandAiTools() {
  const disclosure = screen.getByRole('button', { name: 'AI Tools' });
  if (disclosure.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(disclosure);
  }
}

describe('AiToolsHintSection', () => {
  afterEach(() => {
    localStorage.clear();
    notifyAiFeaturesSettingsChanged();
  });

  it('hides the Design-tab pointer when AI features are off', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    notifyAiFeaturesSettingsChanged();
    render(
      <EditorProvider>
        <AiToolsHintSection />
      </EditorProvider>,
    );
    expect(screen.queryByRole('button', { name: 'AI Tools' })).toBeNull();
  });

  it('points at Photo mode and names the tools that live there', () => {
    render(
      <EditorProvider>
        <AiToolsHintSection />
      </EditorProvider>,
    );
    expandAiTools();
    expect(screen.getByText(/live in Photo mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to photo mode/i })).toBeInTheDocument();
  });

  it('switches the workspace into Photo mode on click', () => {
    render(
      <EditorProvider>
        <ModeReadout />
        <AiToolsHintSection />
      </EditorProvider>,
    );
    expandAiTools();
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('design');
    fireEvent.click(screen.getByRole('button', { name: /switch to photo mode/i }));
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('image');
  });
});
