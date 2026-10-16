// @vitest-environment jsdom

/**
 * The Agent access settings, against the real editor and the real controller.
 *
 * The only thing replaced is the desktop endpoint, which cannot exist in jsdom;
 * that is exactly what the section must say out loud rather than pretend.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAutomationMountForTesting } from '../../automation/desktopMount';
import {
  loadAutomationController,
  publishEditorToAutomation,
  resetAutomationControllerForTesting,
} from '../../automation/liveEditor';
import { EditorProvider, useEditor } from '../../context';
import { loadSettings } from '../../settings';
import { AgentAccessSection } from './AgentAccessSection';
import { SettingsProvider } from './SettingsContext';

type Editor = ReturnType<typeof useEditor>;
let editor: Editor | undefined;

function Publisher() {
  const ctx = useEditor();
  editor = ctx;
  useEffect(() => {
    publishEditorToAutomation(ctx);
  });
  return null;
}

function mount() {
  render(
    <EditorProvider>
      <SettingsProvider>
        <Publisher />
        <AgentAccessSection />
      </SettingsProvider>
    </EditorProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  editor = undefined;
  resetAutomationControllerForTesting();
  resetAutomationMountForTesting();
});

afterEach(() => {
  cleanup();
  resetAutomationControllerForTesting();
  resetAutomationMountForTesting();
});

describe('AgentAccessSection', () => {
  it('starts off, read-only and asking first', () => {
    mount();
    expect((screen.getByLabelText('Off') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.getByText('Ask first')).toBeTruthy();
    expect(screen.getByText('No saving')).toBeTruthy();
    expect(screen.getByText('No images')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Agent access status' }).textContent).toContain(
      'Off',
    );
    // Nothing to attach to while it is off, and no controller was even loaded.
    expect(screen.queryByText(/varve mcp --instance/)).toBeNull();
  });

  it('approval and saving are unavailable while changes are not allowed', () => {
    mount();
    expect((screen.getByLabelText('Ask first') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('No saving') as HTMLInputElement).disabled).toBe(true);
    // Images do not depend on changes: they can be granted on their own.
    expect((screen.getByLabelText('No images') as HTMLInputElement).disabled).toBe(false);
  });

  it('saving and images are separate, explicit choices that persist', () => {
    mount();
    fireEvent.click(screen.getByLabelText('No images'));
    expect(loadSettings().automation.capture).toBe(true);
    expect(loadSettings().automation.grants).toBe('read');

    fireEvent.click(screen.getByLabelText('Read only'));
    const save = screen.getByLabelText('No saving') as HTMLInputElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(loadSettings().automation.save).toBe(true);
  });

  it('persists the choice, and says plainly that a browser cannot listen', async () => {
    mount();
    fireEvent.click(screen.getByLabelText('Off'));
    expect(loadSettings().automation.enabled).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Agent access status' }).textContent).toContain(
        'Unavailable here',
      ),
    );
    expect(screen.getByRole('status', { name: 'Agent access status' }).textContent).toContain(
      'desktop application',
    );
    expect(screen.queryByText(/varve mcp --instance/)).toBeNull();

    fireEvent.click(screen.getByLabelText('Read only'));
    expect(loadSettings().automation.grants).toBe('edit');
    fireEvent.click(screen.getByLabelText('Ask first'));
    expect(loadSettings().automation.requireApproval).toBe(false);
  });

  it('turning it back off returns to Off', async () => {
    mount();
    fireEvent.click(screen.getByLabelText('Off'));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Agent access status' }).textContent).toContain(
        'Unavailable here',
      ),
    );
    fireEvent.click(screen.getByLabelText('On'));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Agent access status' }).textContent).toContain(
        'Off',
      ),
    );
    expect(loadSettings().automation.enabled).toBe(false);
  });

  it('shows a held change, applies it only on Approve, and lists it in the activity', async () => {
    mount();
    await waitFor(() => expect(editor).toBeDefined());
    const controller = await loadAutomationController();
    controller.setCredential('secret');
    controller.setPolicy({ enabled: true, grants: ['read', 'edit'], requireApproval: true });
    act(() => {
      publishEditorToAutomation(editor as Editor);
    });

    const opened = controller.openConnection('ipc');
    if (!opened.ok) throw new Error(opened.message);
    const rpc = async (id: number, method: string, params: unknown) => {
      const line = await opened.connection.handleLine(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      );
      return line === null ? null : (JSON.parse(line) as Record<string, any>);
    };
    await rpc(1, 'session.hello', {
      credential: 'secret',
      client: { name: 'section-test', version: '1' },
      protocolVersions: ['varve.control/1'],
    });
    await waitFor(() => expect(screen.getByText(/section-test/)).toBeTruthy());

    const before = Object.keys((editor as Editor).state.document.nodes).length;
    const pending = rpc(2, 'command.execute', {
      command: 'varve.node.create',
      args: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 },
    });
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(screen.getByText(/wants to run/)).toBeTruthy();
    expect(Object.keys((editor as Editor).state.document.nodes).length).toBe(before);

    fireEvent.click(approve);
    const done = await pending;
    expect(done?.result.outcome).toBe('applied');
    expect(Object.keys((editor as Editor).state.document.nodes).length).toBe(before + 1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
    expect(screen.getByLabelText('Recent agent activity').textContent).toContain('applied');
  });

  it('Decline refuses the change and nothing is created', async () => {
    mount();
    await waitFor(() => expect(editor).toBeDefined());
    const controller = await loadAutomationController();
    controller.setCredential('secret');
    controller.setPolicy({ enabled: true, grants: ['read', 'edit'], requireApproval: true });
    act(() => {
      publishEditorToAutomation(editor as Editor);
    });
    const opened = controller.openConnection('ipc');
    if (!opened.ok) throw new Error(opened.message);
    const rpc = async (id: number, method: string, params: unknown) => {
      const line = await opened.connection.handleLine(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      );
      return line === null ? null : (JSON.parse(line) as Record<string, any>);
    };
    await rpc(1, 'session.hello', {
      credential: 'secret',
      client: { name: 'section-test', version: '1' },
      protocolVersions: ['varve.control/1'],
    });
    const before = Object.keys((editor as Editor).state.document.nodes).length;
    const pending = rpc(2, 'command.execute', {
      command: 'varve.node.create',
      args: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const refused = await pending;
    expect(refused?.result.error.code).toBe('PERMISSION_DENIED');
    expect(Object.keys((editor as Editor).state.document.nodes).length).toBe(before);
  });

  it('Disconnect closes that client, and Pause blocks changes with a readable reason', async () => {
    mount();
    await waitFor(() => expect(editor).toBeDefined());
    const controller = await loadAutomationController();
    controller.setCredential('secret');
    controller.setPolicy({ enabled: true, grants: ['read', 'edit'], requireApproval: false });
    act(() => {
      publishEditorToAutomation(editor as Editor);
    });
    const opened = controller.openConnection('ipc');
    if (!opened.ok) throw new Error(opened.message);
    await opened.connection.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session.hello',
        params: {
          credential: 'secret',
          client: { name: 'section-test', version: '1' },
          protocolVersions: ['varve.control/1'],
        },
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Pause changes' }));
    await screen.findByRole('button', { name: 'Allow changes again' });
    expect(screen.getByRole('status', { name: 'Agent access status' }).textContent).toContain(
      'Paused',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Allow changes again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(opened.connection.shouldClose).toBe(true));
    await waitFor(() => expect(screen.getByText('No agent is connected.')).toBeTruthy());
  });
});
