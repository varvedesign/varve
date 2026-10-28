/* ------------------------------------------------------------------ */
/*  Tab 2: Spacing — Gap Analysis & Harmonize                         */
/* ------------------------------------------------------------------ */

import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../../context';
import {
  analyzeSpacing,
  harmonizeSpacing,
  type SpacingAnalysis,
} from '../../intelligence/spacingHarmonizer';

export function SpacingTab() {
  const { state, selectedNodes, updateDoc } = useEditor();
  const sel = selectedNodes();
  const selIds = sel.map((n) => n.id);

  const [analysis, setAnalysis] = useState<SpacingAnalysis | null>(null);
  const [harmonized, setHarmonized] = useState(false);

  const handleAnalyze = useCallback(() => {
    const result = analyzeSpacing(state.document, selIds);
    setAnalysis(result);
    setHarmonized(false);
  }, [state.document, selIds]);

  const handleHarmonize = useCallback(() => {
    if (!analysis || analysis.gaps.length < 2) return;
    updateDoc((doc) => harmonizeSpacing(doc, selIds));
    setHarmonized(true);
  }, [analysis, selIds, updateDoc]);

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Analyze spacing between selected nodes to detect the dominant gap unit.
      </p>

      <button
        type="button"
        className="intelligence-action-btn"
        disabled={selIds.length < 2}
        onClick={handleAnalyze}
      >
        <Icon name="Ruler" label={undefined} size="0.85em" />
        Analyze
      </button>

      {analysis && (
        <div className="intelligence-analysis">
          <div className="intelligence-analysis__row">
            <span>Base unit</span>
            <span className="intelligence-analysis__value">
              {analysis.detectedBaseUnit != null
                ? `${analysis.detectedBaseUnit}px`
                : 'Not detected'}
            </span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Confidence</span>
            <span className="intelligence-analysis__value">
              {Math.round(analysis.confidence * 100)}%
            </span>
          </div>
          {analysis.gaps.length > 0 && (
            <div className="intelligence-analysis__row">
              <span>Gaps</span>
              <span className="intelligence-analysis__value">{analysis.gaps.join(', ')}px</span>
            </div>
          )}
          <div className="intelligence-analysis__row">
            <span>Suggested gap</span>
            <span className="intelligence-analysis__value">{analysis.suggestedGap}px</span>
          </div>

          <div className="intelligence-gap-histogram">
            <span className="intelligence-histogram__label">Histogram</span>
            <div className="intelligence-histogram__bars">{buildHistogramBars(analysis.gaps)}</div>
          </div>

          {analysis.gaps.length >= 2 && (
            <button type="button" className="intelligence-action-btn" onClick={handleHarmonize}>
              <Icon name="Wand" label={undefined} size="0.85em" />
              Harmonize
            </button>
          )}

          {harmonized && (
            <p className="intelligence-success">
              <Icon name="Check" label={undefined} size="0.85em" />
              Spacing harmonized
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Render fixed-width histogram bars from gap values. */
function buildHistogramBars(gaps: number[]) {
  if (gaps.length === 0) return null;
  const maxGap = Math.max(...gaps);
  const binWidth = 4;
  const binCount = Math.max(1, Math.ceil((maxGap + 1) / binWidth));
  const bins = new Array(binCount).fill(0) as number[];

  for (const gap of gaps) {
    const bin = Math.max(0, Math.min(Math.floor(gap / binWidth), binCount - 1));
    bins[bin]!++;
  }

  const maxFreq = Math.max(...bins, 1);
  const binData = bins.map((freq, bin) => ({ start: bin * binWidth, freq }));

  return binData.map(({ start, freq }) => (
    <Tooltip key={start} label={`${freq} gap(s)`}>
      <div className="intelligence-histogram__bar-wrap" role="img" aria-label={`${freq} gap(s)`}>
        <div
          className="intelligence-histogram__bar"
          style={{ height: `${(freq / maxFreq) * 100}%` }}
        />
        <span className="intelligence-histogram__tick">{start}</span>
      </div>
    </Tooltip>
  ));
}
