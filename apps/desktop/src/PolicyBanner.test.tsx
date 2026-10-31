// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PolicyBanner } from './PolicyBanner';

describe('PolicyBanner', () => {
  it('shows the fixed non-dismissable restricted policy notice', () => {
    render(<PolicyBanner />);
    expect(screen.getByRole('alert').textContent).toContain(
      "Your organisation's Varve policy has errors. Network features are off until IT fixes it. Your work is not affected.",
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
