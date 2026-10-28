/* ------------------------------------------------------------------ */
/*  Linter Config Editor                                              */
/* ------------------------------------------------------------------ */

import { Icon } from '@varve/ui';
import { useEditor } from '../../context';

export function LinterConfigEditor() {
  const { state, updateDoc } = useEditor();
  const config = ((state.document as unknown as Record<string, unknown>).linterConfig ?? {
    version: '1',
    touchTargetMinWidth: 44,
    touchTargetMinHeight: 44,
    touchTargetMinSpacing: 8,
    nonTextContrastThreshold: 3,
  }) as {
    version: string;
    touchTargetMinWidth?: number;
    touchTargetMinHeight?: number;
    touchTargetMinSpacing?: number;
    nonTextContrastThreshold?: number;
    origin?: Record<string, string>;
  };

  const updateField = (key: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    updateDoc((doc) => {
      const docAny = doc as unknown as Record<string, unknown>;
      const existingLinter = docAny.linterConfig as Record<string, unknown> | undefined;
      return {
        ...doc,
        linterConfig: {
          ...(existingLinter ?? { version: '1' }),
          [key]: value,
          version: '1',
          origin: {
            ...((existingLinter?.origin as Record<string, string> | undefined) ?? {}),
            [key]: 'project',
          },
        },
      } as unknown as typeof doc;
    });
  };

  const handleReset = () => {
    updateDoc(
      (doc) =>
        ({
          ...doc,
          linterConfig: {
            version: '1',
            touchTargetMinWidth: 44,
            touchTargetMinHeight: 44,
            touchTargetMinSpacing: 8,
            nonTextContrastThreshold: 3,
          },
        }) as unknown as typeof doc,
    );
  };

  const fields: Array<{
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultVal: number;
    hint: string;
  }> = [
    {
      key: 'touchTargetMinWidth',
      label: 'Touch target min width (px)',
      min: 24,
      max: 88,
      step: 1,
      defaultVal: 44,
      hint: 'WCAG 2.5.8 recommends 44px',
    },
    {
      key: 'touchTargetMinHeight',
      label: 'Touch target min height (px)',
      min: 24,
      max: 88,
      step: 1,
      defaultVal: 44,
      hint: 'WCAG 2.5.8 recommends 44px',
    },
    {
      key: 'touchTargetMinSpacing',
      label: 'Min spacing between targets (px)',
      min: 0,
      max: 48,
      step: 1,
      defaultVal: 8,
      hint: 'Minimum gap between adjacent interactive elements',
    },
    {
      key: 'nonTextContrastThreshold',
      label: 'Non-text contrast ratio',
      min: 2,
      max: 7,
      step: 0.1,
      defaultVal: 3,
      hint: 'WCAG 2.1 SC 1.4.11 requires 3:1',
    },
  ];

  return (
    <details className="intelligence-section" open>
      <summary className="intelligence-section__header">
        <span className="intelligence-section__title">Project Linter Config</span>
      </summary>
      <div className="intelligence-issue-list" style={{ padding: 'var(--space-2)' }}>
        {fields.map((field) => {
          const value =
            (config as unknown as Record<string, number | undefined>)[field.key] ??
            field.defaultVal;
          const origin =
            (config.origin as Record<string, string> | undefined)?.[field.key] ?? 'default';
          return (
            <div key={field.key} style={{ marginBottom: 'var(--space-2)' }}>
              <label
                style={{
                  fontSize: 'var(--font-size-xs)',
                  display: 'block',
                  marginBottom: 'var(--space-1)',
                }}
              >
                {field.label}
                <span
                  style={{
                    fontSize: 'var(--font-size-2xs)',
                    opacity: 0.6,
                    marginLeft: 'var(--space-1)',
                  }}
                >
                  ({origin})
                </span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  onChange={(e) =>
                    updateField(field.key, parseFloat(e.target.value) || field.defaultVal)
                  }
                  style={{ width: '100%', padding: 'var(--space-1) var(--space-1)' }}
                  aria-label={field.label}
                />
              </label>
              <p
                style={{
                  fontSize: 'var(--font-size-2xs)',
                  opacity: 0.6,
                  margin: 'var(--space-1) 0 0',
                }}
              >
                {field.hint}
              </p>
            </div>
          );
        })}
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={handleReset}
          style={{ marginTop: 'var(--space-1)' }}
        >
          <Icon name="RotateCcw" label={undefined} size="0.85em" /> Reset to defaults
        </button>
      </div>
    </details>
  );
}
