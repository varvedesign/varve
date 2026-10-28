/* ------------------------------------------------------------------ */
/*  Tab 3: Naming — Auto-rename Suggestions                           */
/* ------------------------------------------------------------------ */

import { decodeEfficientNetOutput, getInferenceWorkerHost, getModelLoader } from '@varve/engine';
import { imageShapeSrc, isImageShape, type NodeId, type ShapeNode } from '@varve/scene';
import { Icon, Switch } from '@varve/ui';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { type NamingSuggestion, renameSelected, suggestName } from '../../intelligence/autoNamer';
import { loadImageToImageDataForAI } from './similar/similarTypes';

const EFFICIENTNET_MODEL_ID = 'efficientnet-lite4';

export function NamingTab() {
  const { selectedNodes, state, updateDoc } = useEditor();
  const sel = selectedNodes();
  const [onlyDefault, setOnlyDefault] = useState(true);
  const [suggestions, setSuggestions] = useState<NamingSuggestion[]>([]);
  const [imageLabels, setImageLabels] = useState<Map<NodeId, string> | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'classifying'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const labelCacheRef = useRef<Map<string, string>>(new Map());

  const classifyImages = useCallback(async (): Promise<Map<NodeId, string>> => {
    const imageNodes = sel.filter((n) => isImageShape(n));
    const labels = new Map<NodeId, string>();
    if (imageNodes.length === 0) return labels;

    const loader = getModelLoader();
    if (!(await loader.isModelAvailable(EFFICIENTNET_MODEL_ID))) {
      setStatus('downloading');
      setDownloadProgress(0);
      try {
        await loader.downloadModel(EFFICIENTNET_MODEL_ID, (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        });
      } catch {
        // Download failed — fall through with no labels; image nodes keep
        // the plain "Image" fallback rather than blocking the whole batch.
        setStatus('idle');
        return labels;
      }
    }

    setStatus('classifying');
    const modelPath = await loader.getModelPath(EFFICIENTNET_MODEL_ID);
    if (!modelPath) {
      setStatus('idle');
      return labels;
    }
    const host = getInferenceWorkerHost();

    for (const node of imageNodes) {
      const src = imageShapeSrc(node as ShapeNode);
      if (!src) continue;
      const cached = labelCacheRef.current.get(src);
      if (cached) {
        labels.set(node.id, cached);
        continue;
      }
      try {
        const imageData = await loadImageToImageDataForAI(src);
        const result = await host.infer(
          {
            type: 'infer',
            modelType: 'efficientnet',
            modelPath,
            modelId: EFFICIENTNET_MODEL_ID,
            imageData,
            reuseSession: true,
          },
          { timeoutMs: 30_000 },
        );
        const rawOutputs = result.outputs as {
          'Softmax:0'?: { data: Float32Array; dims: number[] };
        };
        const output = rawOutputs['Softmax:0'];
        if (!output) continue;
        const [top] = decodeEfficientNetOutput(output.data, 1);
        if (top) {
          labelCacheRef.current.set(src, top.label);
          labels.set(node.id, top.label);
        }
      } catch {
        // Best-effort per image — one failure shouldn't block the rest.
      }
    }

    setStatus('idle');
    return labels;
  }, [sel]);

  const handleSuggest = useCallback(async () => {
    const labels = await classifyImages();
    setImageLabels(labels);
    const results: NamingSuggestion[] = [];
    for (const node of sel) {
      const suggestion = suggestName(node, state.document, undefined, labels);
      results.push(suggestion);
    }
    setSuggestions(results);
  }, [sel, state.document, classifyImages]);

  const handleApplyAll = useCallback(() => {
    updateDoc((doc) =>
      renameSelected(
        doc,
        sel.map((n) => n.id),
        onlyDefault,
        imageLabels,
      ),
    );
    setSuggestions([]);
    setImageLabels(undefined);
  }, [sel, onlyDefault, updateDoc, imageLabels]);

  const confidenceColor = (c: 'high' | 'medium' | 'low'): string => {
    switch (c) {
      case 'high':
        return 'intelligence-badge--high';
      case 'medium':
        return 'intelligence-badge--medium';
      case 'low':
        return 'intelligence-badge--low';
    }
  };

  const isBusy = status !== 'idle';

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Suggest meaningful names for selected nodes based on their type, content, and layout. Photos
        are identified by content (e.g. "Golden retriever") using a local AI model.
      </p>

      <Switch
        className="intelligence-toggle"
        label="Default names only"
        checked={onlyDefault}
        onChange={(e) => setOnlyDefault(e.target.checked)}
      />

      <button
        type="button"
        className="intelligence-action-btn"
        disabled={sel.length === 0 || isBusy}
        onClick={() => void handleSuggest()}
      >
        <Icon name="Wand" label={undefined} size="0.85em" />
        {isBusy ? 'Suggesting…' : 'Suggest names'}
      </button>

      {status === 'downloading' && (
        <>
          <div
            className="insp-progress-bar"
            role="progressbar"
            aria-valuenow={downloadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="insp-progress-bar__fill" style={{ width: `${downloadProgress}%` }} />
          </div>
          <p aria-live="polite">Downloading photo-identification model… {downloadProgress}%</p>
        </>
      )}
      {status === 'classifying' && <p aria-live="polite">Identifying photo content…</p>}

      {suggestions.length > 0 && (
        <>
          <div className="intelligence-suggestion-list">
            {suggestions.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: suggestion names can repeat across nodes; rows are stateless (no id in NamingSuggestion)
              <div key={i} className="intelligence-suggestion">
                <span className="intelligence-suggestion__name">{s.name}</span>
                <span className={`intelligence-badge ${confidenceColor(s.confidence)}`}>
                  {s.confidence}
                </span>
              </div>
            ))}
          </div>

          <button type="button" className="intelligence-action-btn" onClick={handleApplyAll}>
            <Icon name="Check" label={undefined} size="0.85em" />
            Apply all
          </button>
        </>
      )}
    </div>
  );
}
