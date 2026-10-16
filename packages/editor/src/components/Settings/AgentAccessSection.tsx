/**
 * Settings > Agent access.
 *
 * The one place a person decides whether anything outside Varve can look at or
 * change their open document, and sees what it is doing. Everything here is the
 * person's: no command can reach these controls, and turning the switch off
 * closes every connection without touching the document.
 *
 * Status never relies on colour alone: each state is a word, and the pending
 * approvals and the activity log are lists with text outcomes.
 */
import { Button, CopyButton, SwitchField } from '@varve/ui';
import { useAutomationStatus } from '../../automation/useAutomationStatus';
import { useSettings } from './SettingsContext';
import { SettingsFieldRow } from './SettingsFieldRow';
import './AgentAccessSection.css';

const STATE_LABEL: Record<string, string> = {
  off: 'Off',
  starting: 'Starting',
  running: 'Running',
  unreachable: 'Unavailable here',
  error: 'Could not start',
};

function clock(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/** Arguments are data from another program: shown as bounded plain text only. */
function argsPreview(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args) ?? '';
  } catch {
    return '(arguments could not be shown)';
  }
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

export function AgentAccessSection() {
  const { settings, updateSection } = useSettings();
  const view = useAutomationStatus();
  const automation = settings.automation;
  const host = view.controller?.host ?? null;
  const approvals = view.controller?.pendingApprovals ?? [];
  const activity = [...(view.controller?.activity ?? [])].reverse().slice(0, 20);
  const attach =
    view.mount.state === 'running' && view.mount.instanceId
      ? `varve mcp --instance ${view.mount.instanceId}`
      : null;

  return (
    <div className="settings-section agent-access">
      <h3 className="settings-section__title">Agent access</h3>
      <p className="settings-section__description">
        Let a program on this computer, such as an MCP client or a script, inspect the document you
        have open. It is off by default, local to this machine, and everything an agent does is
        listed below and can be undone. Layer names, text and other document content are shown to
        the agent as data; the agent's own model may still send what it reads to its provider.
      </p>

      <SettingsFieldRow label="Allow local agents to connect">
        <SwitchField
          label={automation.enabled ? 'On' : 'Off'}
          checked={automation.enabled}
          onChange={(event) => updateSection('automation', { enabled: event.target.checked })}
          id="agent-access-enabled"
        />
      </SettingsFieldRow>
      <SettingsFieldRow label="Allow agents to make changes">
        <SwitchField
          label={automation.grants === 'edit' ? 'Changes allowed' : 'Read only'}
          checked={automation.grants === 'edit'}
          onChange={(event) =>
            updateSection('automation', { grants: event.target.checked ? 'edit' : 'read' })
          }
          id="agent-access-edit"
        />
      </SettingsFieldRow>
      <SettingsFieldRow label="Ask me before each change">
        <SwitchField
          label={automation.requireApproval ? 'Ask first' : 'Apply without asking'}
          checked={automation.requireApproval}
          disabled={automation.grants !== 'edit'}
          onChange={(event) =>
            updateSection('automation', { requireApproval: event.target.checked })
          }
          id="agent-access-approval"
        />
      </SettingsFieldRow>
      <p className="settings-section__hint">
        Capture, export and anything that leaves this computer stay unavailable to agents. Turning
        this off disconnects every agent immediately and does not undo changes already made.
      </p>

      <div
        className="agent-access__status"
        data-state={view.mount.state}
        role="status"
        aria-label="Agent access status"
      >
        <span className="agent-access__state">{STATE_LABEL[view.mount.state]}</span>
        {view.mount.message ? (
          <span className="agent-access__message">{view.mount.message}</span>
        ) : null}
        {host?.paused ? (
          <span className="agent-access__message">
            Paused: {host.pausedReason ?? 'changes are blocked'}
          </span>
        ) : null}
      </div>

      {attach ? (
        <div className="agent-access__attach">
          <span className="agent-access__label">Attach an MCP client to this window</span>
          <code className="agent-access__command">{attach}</code>
          <CopyButton value={attach} label="Copy attach command" size="sm" variant="secondary" />
          <p className="settings-section__hint">
            The credential stays in a file only your user can read; it is never shown here.
          </p>
        </div>
      ) : null}

      {approvals.length > 0 ? (
        <section className="agent-access__panel" aria-label="Changes waiting for your approval">
          <h4 className="agent-access__heading">Waiting for your approval</h4>
          <ul className="agent-access__list">
            {approvals.map((request) => (
              <li key={request.receiptId} className="agent-access__item">
                <div className="agent-access__item-main">
                  <strong>{request.principal.label}</strong> wants to run{' '}
                  <strong>{request.commandTitle}</strong>
                  {request.preview ? (
                    <span className="agent-access__muted">
                      {' '}
                      ({request.preview.created.length} created, {request.preview.changed.length}{' '}
                      changed, {request.preview.deleted.length} deleted)
                    </span>
                  ) : null}
                  <div className="agent-access__muted">
                    On {request.target.documentName}, revision {request.revision}
                  </div>
                  <code className="agent-access__args">{argsPreview(request.args)}</code>
                </div>
                <div className="agent-access__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => view.decide(request.receiptId, { approved: true })}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      view.decide(request.receiptId, { approved: false, reason: 'declined' })
                    }
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {host ? (
        <section className="agent-access__panel" aria-label="Connected agents">
          <h4 className="agent-access__heading">Connected agents</h4>
          {host.connections.length === 0 ? (
            <p className="agent-access__muted">No agent is connected.</p>
          ) : (
            <ul className="agent-access__list">
              {host.connections.map((connection) => (
                <li key={connection.connectionId} className="agent-access__item">
                  <div className="agent-access__item-main">
                    <strong>{connection.client?.name ?? connection.label}</strong>
                    {connection.client?.version ? ` ${connection.client.version}` : ''}
                    <span className="agent-access__muted"> ({connection.state})</span>
                  </div>
                  <div className="agent-access__actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!connection.principalId}
                      onClick={() => {
                        if (connection.principalId) view.revoke(connection.principalId);
                      }}
                    >
                      Disconnect
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="agent-access__actions">
            {host.paused ? (
              <Button variant="secondary" size="sm" onClick={view.resume}>
                Allow changes again
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={view.pause}>
                Pause changes
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {activity.length > 0 ? (
        <section className="agent-access__panel" aria-label="Recent agent activity">
          <h4 className="agent-access__heading">Recent activity</h4>
          <ol className="agent-access__list">
            {activity.map((entry) => (
              <li key={entry.seq} className="agent-access__item agent-access__item--log">
                <span className="agent-access__muted">{clock(entry.at)}</span>{' '}
                <strong>{entry.client}</strong> {entry.command}:{' '}
                <span className="agent-access__outcome">{entry.outcome}</span>
                {entry.code ? <span className="agent-access__muted"> ({entry.code})</span> : null}
                <div className="agent-access__muted">{entry.summary}</div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
