// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addChild, createDocument, makeShapeNode } from '@varve/scene';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createActionHandlers } from '../../actions/createActionHandlers';
import { EditorProvider, useEditor } from '../../context';
import {
  resetPanelLocalStateForTest,
  restorePanelLocalState,
} from '../../workspace/panelLocalState';
import { PropertiesPanel } from './PropertiesPanel';

function SetupCommand() {
  const editor = useEditor();
  useEffect(() => editor.setSelection('export-target'), []);
  return (
    <button type="button" onClick={() => createActionHandlers(editor).openExportPanel?.()}>
      Run export setup command
    </button>
  );
}

beforeEach(() => resetPanelLocalStateForTest());
afterEach(() => {
  cleanup();
  resetPanelLocalStateForTest();
});

it('export setup reveals format controls after remembering the Code subtab', async () => {
  let doc = createDocument('export-handoff');
  doc = addChild(
    doc,
    doc.pages?.[0]?.contentRoot as string,
    makeShapeNode('export-target', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }),
  );
  restorePanelLocalState('inspector', { activeTab: 'export', exportSubTab: 'code' });
  render(
    <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
      <SetupCommand />
      <PropertiesPanel />
    </EditorProvider>,
  );
  expect(await screen.findByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Run export setup command' }));
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Format' })).toHaveAttribute('aria-selected', 'true'),
  );
  expect(screen.getByRole('heading', { name: 'Export configurations' })).toBeVisible();
  await waitFor(() => expect(document.getElementById('insp-tab-export')).toHaveFocus());
});
