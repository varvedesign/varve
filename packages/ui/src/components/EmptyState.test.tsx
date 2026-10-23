import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders headline', () => {
    render(<EmptyState illustration={<svg />} headline="No files" />);
    expect(screen.getByText('No files')).toBeDefined();
  });

  it('renders description when provided', () => {
    render(
      <EmptyState illustration={<svg />} headline="Empty" description="Create your first design" />,
    );
    expect(screen.getByText('Create your first design')).toBeDefined();
  });

  it('renders actions slot', () => {
    render(
      <EmptyState
        illustration={<svg />}
        headline="Empty"
        actions={<button type="button">CTA</button>}
      />,
    );
    expect(screen.getByText('CTA')).toBeDefined();
  });

  // The default stays h3 so existing callers keep their outline; a surface
  // whose page heading is h1 opts into h2 to avoid skipping a level.
  it('defaults the headline to h3', () => {
    render(<EmptyState illustration={<svg />} headline="Empty" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Empty' })).toBeDefined();
  });

  it('renders the headline at the requested level', () => {
    render(<EmptyState illustration={<svg />} headline="Empty" headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Empty' })).toBeDefined();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });
});
