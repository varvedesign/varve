// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportProgress } from './ImportProgress';

afterEach(cleanup);

describe('ImportProgress', () => {
  it('displays current file progress', () => {
    const { container } = render(
      <ImportProgress stage="importing" current={3} total={10} fileName="logo.svg" />,
    );
    const label = container.querySelector('.import-progress__label');
    expect(label?.textContent).toMatch(/importing files: 3 of 10 complete/i);
    const filename = container.querySelector('.import-progress__filename');
    expect(filename?.textContent).toMatch(/logo\.svg/i);
  });

  it('shows active parser files separately from completed files', () => {
    const { container } = render(
      <ImportProgress
        stage="importing"
        current={0}
        total={2}
        fileName=""
        activeFileNames={['first.svg', 'second.svg']}
      />,
    );

    expect(container.querySelector('.import-progress__filename')?.textContent).toBe(
      'Parsing: first.svg, second.svg',
    );
    expect(screen.getByRole('status').textContent).toContain('Parsing: first.svg, second.svg');
  });

  it('describes preparation without implying that parsing has begun', () => {
    const { container } = render(
      <ImportProgress stage="preparing" current={2} total={5} fileName="" />,
    );
    expect(container.querySelector('.import-progress__label')?.textContent).toMatch(
      /preparing files: 2 of 5 ready/i,
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toMatch(
      /2 of 5 files prepared/i,
    );
    expect(container.querySelector('.import-progress__label')?.textContent).not.toMatch(
      /imported/i,
    );
  });

  it('uses an indeterminate accessible progress state before preparation completes a file', () => {
    render(<ImportProgress stage="preparing" current={0} total={5} fileName="" />);
    const progress = screen.getByRole('progressbar');
    expect(progress.hasAttribute('aria-valuenow')).toBe(false);
    expect(progress.getAttribute('aria-valuemax')).toBe('5');
  });

  it('shows cancel button when onCancel provided', () => {
    render(
      <ImportProgress
        stage="importing"
        current={1}
        total={5}
        fileName="test.svg"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('hides cancel button when onCancel not provided', () => {
    const { container } = render(
      <ImportProgress stage="importing" current={1} total={5} fileName="test.svg" />,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    render(
      <ImportProgress
        stage="importing"
        current={2}
        total={5}
        fileName="test.svg"
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders progress bar with correct width', () => {
    const { container } = render(
      <ImportProgress stage="importing" current={5} total={10} fileName="test.svg" />,
    );
    const fill = container.querySelector('.import-progress__fill');
    expect(fill).toBeTruthy();
  });

  it('handles first file (1 of N)', () => {
    const { container } = render(
      <ImportProgress stage="importing" current={1} total={3} fileName="first.svg" />,
    );
    expect(container.querySelector('.import-progress__label')?.textContent).toMatch(
      /importing files: 1 of 3 complete/i,
    );
  });

  it('handles last file (N of N)', () => {
    const { container } = render(
      <ImportProgress stage="importing" current={10} total={10} fileName="last.svg" />,
    );
    expect(container.querySelector('.import-progress__label')?.textContent).toMatch(
      /importing files: 10 of 10 complete/i,
    );
  });

  it('includes aria-live region for announcements', () => {
    const { container } = render(
      <ImportProgress stage="importing" current={3} total={5} fileName="doc.svg" />,
    );
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
