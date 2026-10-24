/**
 * Varve `<Checkbox>` — accessible checkbox (design system refresh).
 *
 * The tick and the dash are drawn as plain strokes on the box itself. They used to be
 * the filled check-square icon, which put a second square inside the box. Follows APG
 * Checkbox pattern with proper ARIA attributes and keyboard navigation. Supports
 * indeterminate state.
 */

import { forwardRef, useId } from 'react';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  indeterminate?: boolean;
  /** Optional description linked via aria-describedby. */
  description?: string;
  /** Optional error message linked via aria-describedby. */
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, description, error, className = '', id, ...rest },
  ref,
) {
  const generatedId = useId();
  const checkboxId = id || generatedId;
  const errorId = `${checkboxId}-error`;
  const descriptionId = description ? `${checkboxId}-description` : undefined;

  const describedBy =
    [error ? errorId : undefined, descriptionId].filter(Boolean).join(' ') || undefined;

  return (
    <label className={`varve-checkbox${className ? ` ${className}` : ''}`}>
      <input
        ref={ref}
        id={checkboxId}
        type="checkbox"
        className="varve-checkbox__input"
        data-indeterminate={indeterminate ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
        // WCAG 4.1.2 (2026-08-10): indeterminate must be announced as
        // aria-checked="mixed", not just drawn as a minus icon.
        aria-checked={
          indeterminate
            ? 'mixed'
            : rest.checked === undefined
              ? undefined
              : rest.checked
                ? 'true'
                : 'false'
        }
      />
      <span className="varve-checkbox__box">
        <svg
          className="varve-checkbox__check"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3.75 8.5 6.75 11.5 12.25 4.75" />
        </svg>
        <svg
          className="varve-checkbox__indeterminate"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4.25 8h7.5" />
        </svg>
      </span>
      {label && <span className="varve-checkbox__label">{label}</span>}
      {description && (
        <span className="varve-checkbox__description" id={descriptionId}>
          {description}
        </span>
      )}
      {error && (
        <span className="varve-checkbox__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </label>
  );
});
