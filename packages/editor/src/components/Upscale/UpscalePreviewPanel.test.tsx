// @vitest-environment jsdom
/**
 * Unit tests for the Enhance preview panel's viewport states.
 *
 * E2E covers the settled comparison path, but the no-output, failed, and
 * before-only states are transient in a real browser (the CPU preview lands
 * in ~250ms), so they are asserted here where the props are controlled.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpscalePreviewPanel, type UpscalePreviewPanelProps } from './UpscalePreviewPanel';

function baseProps(overrides: Partial<UpscalePreviewPanelProps> = {}): UpscalePreviewPanelProps {
  return {
    sourceDataUrl: 'data:image/png;base64,AAAA',
    baselineUrl: null,
    enhancedUrl: null,
    referenceWidth: 480,
    referenceHeight: 640,
    previewGenerating: false,
    previewError: null,
    onRetry: vi.fn(),
    canRetry: true,
    previewFocus: { x: 0.5, y: 0.5 },
    onPreviewFocusChange: vi.fn(),
    pixelArt: false,
    afterLabel: 'Enhanced',
    statusText: 'Source image',
    aiHint: null,
    outputNote: 'Output: 960x1280px',
    inspectNote: 'Center · 480 x 640 px of 960 x 1280 px',
    sourceWidth: 960,
    sourceHeight: 1280,
    region: { x: 240, y: 320, width: 480, height: 640 },
    ...overrides,
  };
}

describe('UpscalePreviewPanel viewport', () => {
  it('keeps After and Compare selectable so a pending preview can report itself', () => {
    render(<UpscalePreviewPanel {...baseProps()} />);

    // Before a preview lands the result sides stay selectable: the pending
    // notice must be reachable, not hidden behind a disabled control.
    const viewGroup = within(screen.getByRole('radiogroup', { name: 'Preview view' }));
    expect(viewGroup.getByRole('radio', { name: 'After' })).toBeEnabled();
    expect(viewGroup.getByRole('radio', { name: 'Compare' })).toBeEnabled();
    expect(viewGroup.getByRole('radio', { name: 'Before' })).toBeChecked();
  });

  it('disables Before only when there is no source image at all', () => {
    render(<UpscalePreviewPanel {...baseProps({ sourceDataUrl: '', baselineUrl: null })} />);

    expect(
      within(screen.getByRole('radiogroup', { name: 'Preview view' })).getByRole('radio', {
        name: 'Before',
      }),
    ).toBeDisabled();
  });

  it('enables the full comparison once a processed preview lands', () => {
    render(
      <UpscalePreviewPanel
        {...baseProps({
          baselineUrl: 'data:image/png;base64,BBBB',
          enhancedUrl: 'data:image/png;base64,CCCC',
        })}
      />,
    );

    const viewGroup = within(screen.getByRole('radiogroup', { name: 'Preview view' }));
    expect(viewGroup.getByRole('radio', { name: 'After' })).toBeEnabled();
    expect(viewGroup.getByRole('radio', { name: 'Compare' })).toBeEnabled();
    expect(screen.getByRole('slider', { name: 'Before / after comparison' })).toBeVisible();
  });

  it('shows an honest pending notice while no processed preview exists', () => {
    render(<UpscalePreviewPanel {...baseProps()} />);

    expect(screen.getByText('No processed preview yet')).toBeVisible();
    // The notice is text, never an <img> carrying the after label.
    expect(screen.queryByAltText(/Enhanced preview/)).toBeNull();
  });

  it('reports a failed preview instead of a generic pending one', () => {
    render(<UpscalePreviewPanel {...baseProps({ previewError: 'Worker unavailable' })} />);

    expect(screen.getByText('Preview failed')).toBeVisible();
  });

  it('reports generation while the preview pipeline is running', () => {
    render(<UpscalePreviewPanel {...baseProps({ previewGenerating: true })} />);

    // Announced exactly once, by the panel's own live region. `@varve/ui`
    // also mounts an empty shared announcer with role=status, so counting
    // roles across the whole tree would be counting the wrong thing.
    expect(screen.getAllByText('Generating preview…')).toHaveLength(1);
    const live = document.querySelector('.upscale-preview__status-row');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Generating preview…');
  });

  it('shows a comparison slider once the processed preview lands', () => {
    render(<UpscalePreviewPanel {...baseProps({ enhancedUrl: 'data:image/png;base64,zzzz' })} />);

    expect(screen.getByRole('slider', { name: 'Before / after comparison' })).toBeVisible();
  });

  it('offers a visible retry when preview generation failed', () => {
    const onRetry = vi.fn();
    render(<UpscalePreviewPanel {...baseProps({ previewError: 'Worker unavailable', onRetry })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Worker unavailable');
    const retry = screen.getByRole('button', { name: 'Retry preview' });
    expect(retry).toBeEnabled();
  });

  it('hides the retry action when the failure is not recoverable yet', () => {
    render(
      <UpscalePreviewPanel
        {...baseProps({ previewError: 'Worker unavailable', canRetry: false })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Worker unavailable');
    expect(screen.queryByRole('button', { name: 'Retry preview' })).toBeNull();
  });

  it('picks pixel rendering for pixel-art mode and smooth rendering otherwise', () => {
    const { container, unmount } = render(
      <UpscalePreviewPanel {...baseProps({ pixelArt: true })} />,
    );
    expect(container.querySelector('.upscale-preview__image--original')).toHaveStyle({
      imageRendering: 'pixelated',
    });
    unmount();

    const smooth = render(<UpscalePreviewPanel {...baseProps({ pixelArt: false })} />);
    expect(smooth.container.querySelector('.upscale-preview__image--original')).toHaveStyle({
      imageRendering: 'auto',
    });
  });
});

describe('UpscalePreviewPanel inspect region', () => {
  it('offers the regions through one labelled select alongside the hint', () => {
    render(<UpscalePreviewPanel {...baseProps()} />);

    // One control with an accessible name, on the line that describes what the
    // preview is showing — not a block of squares above the stage.
    expect(screen.getByRole('combobox', { name: 'Inspect region' })).toBeVisible();
    expect(screen.getByText(/Output: 960x1280px/)).toBeVisible();
  });

  it('states which region is selected and how many source pixels it covers', () => {
    render(
      <UpscalePreviewPanel
        {...baseProps({ inspectNote: 'Top left · 144 x 256 px of 476 x 848 px' })}
      />,
    );

    expect(screen.getByText('Top left · 144 x 256 px of 476 x 848 px')).toBeVisible();
  });

  it('degrades to no navigator when a caller omits the region', () => {
    // A caller predating the navigator passed no region; dereferencing
    // `region.x` white-screened the whole editor instead of simply omitting
    // the reference image.
    const { container } = render(
      <UpscalePreviewPanel
        {...baseProps({ sourceWidth: undefined, sourceHeight: undefined, region: undefined })}
      />,
    );

    expect(container.querySelector('.upscale-preview__navigator')).toBeNull();
    expect(container.querySelector('.upscale-preview__navigator-window')).toBeNull();
    // Everything else is unaffected: the control and the readout still work.
    expect(screen.getByRole('combobox', { name: 'Inspect region' })).toBeVisible();
    expect(screen.getByText(/Output: 960x1280px/)).toBeVisible();
    expect(screen.queryByRole('slider', { name: 'Before / after comparison' })).toBeNull();
  });

  it('marks a sub-rectangle over the whole source, never the whole image', () => {
    render(<UpscalePreviewPanel {...baseProps()} />);

    const nav = document.querySelector('.upscale-preview__navigator') as HTMLElement | null;
    const win = nav?.querySelector('.upscale-preview__navigator-window') as HTMLElement | null;
    expect(nav).not.toBeNull();
    expect(win).not.toBeNull();

    const px = (value: string) => Number.parseFloat(value);
    // The window is half the source on each axis here, so it must occupy half
    // the navigator in both directions. An absent or full-size window is what
    // makes a bounded crop read as "the full image".
    expect(px(win!.style.width)).toBeLessThan(px(nav!.style.width));
    expect(px(win!.style.height)).toBeLessThan(px(nav!.style.height));
    expect(px(win!.style.left)).toBeGreaterThan(0);
    expect(px(win!.style.top)).toBeGreaterThan(0);
  });

  it('reports the chosen region as source-relative coordinates', async () => {
    const onPreviewFocusChange = vi.fn();
    render(<UpscalePreviewPanel {...baseProps({ onPreviewFocusChange })} />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Inspect region' }));
    // The listbox mounts through the floating layer on a later tick.
    fireEvent.click(await screen.findByRole('option', { name: 'Top right' }));

    expect(onPreviewFocusChange).toHaveBeenCalledWith({ x: 1, y: 0 });
  });
});
