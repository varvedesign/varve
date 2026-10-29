// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { createDocument, makeImageShapeNode } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_DISABLED_HINT } from '../../../../features/useAiFeaturesEnabled';
import { DEFAULT_EDITOR_SETTINGS, saveSettings } from '../../../../settings';
import { SettingsProvider } from '../../../Settings/SettingsContext';

vi.mock('../../../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('../../sections/AIDenoiseSection', () => ({
  AIDenoiseSection: () => <div>AI Denoise</div>,
}));
vi.mock('../../sections/ColorizeSection', () => ({
  ColorizeSection: () => <div>Colorize</div>,
}));
vi.mock('../../sections/DepthMaskSection', () => ({
  DepthMaskSection: () => <div>Depth Mask</div>,
}));
vi.mock('../../sections/DetectTextSection', () => ({
  DetectTextSection: () => <div>Detect Text Regions</div>,
}));
vi.mock('../../sections/OcrSection', () => ({
  OcrSection: () => <div>Recognize Text</div>,
}));
vi.mock('../../sections/FontDetectSection', () => ({
  FontDetectSection: () => <div>Identify Font</div>,
}));
vi.mock('../../sections/BlendImagesSection', () => ({
  FrameInterpolationSection: () => <div>Frame Interpolation</div>,
}));
vi.mock('../../sections/LineArtSection', () => ({
  LineArtSection: () => <div>Line Art</div>,
}));
vi.mock('../../sections/ImageEnhancementSection', () => ({
  ImageEnhancementSection: () => <div>Image Enhancement</div>,
}));
vi.mock('../../sections/BackgroundRemovalSection', () => ({
  BackgroundRemovalSection: () => <div>Background Removal</div>,
}));
vi.mock('../../sections/ContentAwareFillSection', () => ({
  ContentAwareFillSection: () => <div>Generative Edit</div>,
}));
vi.mock('../../sections/ImageTuningSection', () => ({
  ImageTuningSection: () => <div>Image Tuning</div>,
}));
vi.mock('../../sections/EffectStudioAccessSection', () => ({
  EffectStudioAccessSection: () => null,
}));
vi.mock('../../sections/LensBlurSection', () => ({
  LensBlurSection: () => <div>Lens Blur</div>,
}));

import { useEditor } from '../../../../context';
import { AdjustmentsPanel } from '../AdjustmentsPanel';

function persistAi(enabled: boolean): void {
  saveSettings({
    ...DEFAULT_EDITOR_SETTINGS,
    ai: { ...DEFAULT_EDITOR_SETTINGS.ai, enabled },
  });
}

function renderForImage(aiEnabled: boolean) {
  persistAi(aiEnabled);
  const image = makeImageShapeNode('img-1', { src: 'data:image/png;base64,aaa', w: 64, h: 64 });
  const document = createDocument('AI gate');
  vi.mocked(useEditor).mockReturnValue({
    selectedNodes: () => [image],
    openCafDialog: vi.fn(),
    state: {
      document: {
        ...document,
        rootChildren: [image.id],
        nodes: { ...document.nodes, [image.id]: image },
      },
      sectionVisibility: {},
      selection: [image.id],
    },
    updateNode: vi.fn(),
    updateNodes: vi.fn(),
    updateDoc: vi.fn(),
    announce: vi.fn(),
  } as unknown as ReturnType<typeof useEditor>);

  return render(
    <SettingsProvider>
      <AdjustmentsPanel />
    </SettingsProvider>,
  );
}

describe('AdjustmentsPanel AI master switch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('hides model-backed sections when AI features are off', () => {
    renderForImage(false);

    expect(screen.getAllByText(AI_DISABLED_HINT).length).toBeGreaterThan(0);
    expect(screen.queryByText('AI Denoise')).not.toBeInTheDocument();
    expect(screen.queryByText('Colorize')).not.toBeInTheDocument();
    expect(screen.queryByText('Depth Mask')).not.toBeInTheDocument();
    expect(screen.queryByText('Detect Text Regions')).not.toBeInTheDocument();
    expect(screen.queryByText('Recognize Text')).not.toBeInTheDocument();
    expect(screen.queryByText('Identify Font')).not.toBeInTheDocument();
    expect(screen.queryByText('Frame Interpolation')).not.toBeInTheDocument();
    expect(screen.queryByText('Line Art')).not.toBeInTheDocument();
  });

  it('shows model-backed sections when AI features are on', () => {
    renderForImage(true);

    expect(screen.queryByText(AI_DISABLED_HINT)).not.toBeInTheDocument();
    expect(screen.getByText('AI Denoise')).toBeInTheDocument();
    expect(screen.getByText('Colorize')).toBeInTheDocument();
    expect(screen.getByText('Depth Mask')).toBeInTheDocument();
    expect(screen.getByText('Detect Text Regions')).toBeInTheDocument();
    expect(screen.getByText('Recognize Text')).toBeInTheDocument();
    expect(screen.getByText('Identify Font')).toBeInTheDocument();
    expect(screen.getByText('Frame Interpolation')).toBeInTheDocument();
    expect(screen.getByText('Line Art')).toBeInTheDocument();
  });
});
