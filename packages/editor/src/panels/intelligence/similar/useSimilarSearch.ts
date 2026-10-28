import {
  embedTextForSearchWith,
  getModelLoader,
  imageEmbeddingSpecFor,
  normalizeEmbedding,
  SIGLIP_TEXT_MODEL_ID,
} from '@varve/engine';
import {
  dHash,
  type EmbeddingVector,
  embedImageForSearchWith,
  pHash,
  SIGLIP_TEXT_EMBEDDING_SPEC,
  type SimilarityCandidate,
  type SimilaritySearchMode,
  searchNearDuplicates,
  searchSemantic,
} from '@varve/engine/semanticSimilarity';
import {
  assetEmbeddingKey,
  decodeFloat32Embedding,
  IndexedDbSemanticEmbeddingStore,
  makeAssetEmbeddingRecord,
  type SemanticEmbeddingStore,
} from '@varve/platform';
import { imageShapeSrc, isImageShape, type NodeId, type ShapeNode } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { contentHashForSrc } from '../../../semantic/contentHash';
import {
  EMBED_IMAGE_MODEL,
  EMBED_IMAGE_MODEL_ID,
  loadImageToImageDataForAI,
  MAX_SIMILAR_CANDIDATES,
  type SimilarMatch,
} from './similarTypes';

export function useSimilarSearch() {
  const { state, announce } = useEditor();
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const embeddingCacheRef = useRef<Map<string, EmbeddingVector>>(new Map());
  const embeddingStoreRef = useRef<SemanticEmbeddingStore | null>(null);
  const imageDataCacheRef = useRef<Map<string, ImageData>>(new Map());
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [textModelAvailable, setTextModelAvailable] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<'idle' | 'downloading' | 'searching' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<SimilarMatch[] | null>(null);
  const [searchMode, setSearchMode] = useState<SimilaritySearchMode>('semantic');
  const [scannedCount, setScannedCount] = useState(0);
  const usingTestEmbedder = Boolean(window.__varveSimilarityTest?.mockEmbed);

  const selectedNode =
    state.selection.length === 1 ? state.document.nodes[state.selection[0]!] : null;
  const isImage = Boolean(selectedNode && isImageShape(selectedNode));
  const imageSrc = isImage ? imageShapeSrc(selectedNode as ShapeNode) : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const [available, textAvailable] = await Promise.all([
        loader.isModelAvailable(EMBED_IMAGE_MODEL_ID),
        loader.isModelAvailable(SIGLIP_TEXT_MODEL_ID),
      ]);
      if (!cancelled) {
        setModelAvailable(available);
        setTextModelAvailable(textAvailable);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownload = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        EMBED_IMAGE_MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setStatus('idle');
      setModelAvailable(true);
      announce('Find Similar model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : 'Download failed');
      setStatus('error');
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const handleDownloadTextModel = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      await getModelLoader().downloadModel(
        SIGLIP_TEXT_MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setTextModelAvailable(true);
      setStatus('idle');
      announce('Natural-language search model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : 'Download failed');
      setStatus('error');
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const embed = useCallback(
    async (
      src: string,
      modelPath: string,
      signal: AbortSignal,
      space: {
        model: typeof EMBED_IMAGE_MODEL;
      } = {
        model: EMBED_IMAGE_MODEL,
      },
    ): Promise<EmbeddingVector> => {
      // E2E-only deterministic seam (see WindowSimilarityTestHook).
      const testMock = window.__varveSimilarityTest?.mockEmbed;
      if (testMock) {
        const mocked = await testMock(src);
        if (signal.aborted) throw new Error('cancelled');
        return mocked;
      }

      const identity = {
        contentHash: await contentHashForSrc(src),
        modelId: space.model.id,
        modelVersion: space.model.revision,
        preprocessingVersion: space.model.preprocessingVersion,
        embeddingSchemaVersion: 'semantic-embedding-v1',
      };
      const cacheKey = assetEmbeddingKey(identity);
      const cached = embeddingCacheRef.current.get(cacheKey);
      if (cached) return cached;

      if (!embeddingStoreRef.current && typeof indexedDB !== 'undefined') {
        embeddingStoreRef.current = new IndexedDbSemanticEmbeddingStore();
      }
      const stored = await embeddingStoreRef.current?.get(cacheKey).catch(() => null);
      if (stored) {
        const embedding: EmbeddingVector = {
          modelId: stored.identity.modelId,
          modelRevision: stored.identity.modelVersion,
          embeddingSpaceVersion: space.model.embeddingSpaceVersion,
          preprocessingVersion: stored.identity.preprocessingVersion,
          dimension: stored.dimension,
          // The platform store labels raw float buffers 'float32'; the
          // embedding contract's vocabulary is fp32/fp16/int8.
          dtype: 'fp32',
          normalized: true,
          values: normalizeEmbedding(decodeFloat32Embedding(stored.bytes, stored.dimension)),
        };
        embeddingCacheRef.current.set(cacheKey, embedding);
        return embedding;
      }

      let imageData = imageDataCacheRef.current.get(src);
      if (!imageData) {
        imageData = await loadImageToImageDataForAI(src);
        imageDataCacheRef.current.set(src, imageData);
      }
      if (signal.aborted) throw new Error('cancelled');

      const runtimeSpec = imageEmbeddingSpecFor(space.model.id);
      if (!runtimeSpec) {
        throw new Error(`No embedding runtime registered for model '${space.model.id}'`);
      }
      const embedding = await embedImageForSearchWith(
        { width: imageData.width, height: imageData.height, data: imageData.data },
        runtimeSpec,
        modelPath,
        signal,
      );
      embeddingCacheRef.current.set(cacheKey, embedding);
      const store = embeddingStoreRef.current;
      if (store) {
        await store
          .put(
            makeAssetEmbeddingRecord(identity, embedding.values, {
              contentId: src,
              sourceGeneration: src,
              createdAt: Date.now(),
            }),
          )
          .catch(() => {
            // Derived cache persistence is best-effort; source search remains usable.
          });
      }
      return embedding;
    },
    [],
  );

  const embedText = useCallback(async (query: string, modelPath: string, signal: AbortSignal) => {
    return embedTextForSearchWith(query, SIGLIP_TEXT_EMBEDDING_SPEC, modelPath, signal);
  }, []);

  const handleSearch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('searching');
    setErrorMessage(null);

    try {
      const testMock = window.__varveSimilarityTest?.mockEmbed;
      const loader = getModelLoader();
      const imageModelPath = testMock
        ? '/mock/model.onnx'
        : await loader.getModelPath(EMBED_IMAGE_MODEL_ID, controller.signal);
      if (!imageModelPath) throw new Error('Find Similar image model not downloaded');

      const textQuery = queryText.trim();
      const isTextSearch = textQuery.length > 0;
      if (isTextSearch && !textModelAvailable) {
        throw new Error('Download the natural-language search model first');
      }

      const queryEmbedding = isTextSearch
        ? await embedText(
            textQuery,
            (await loader.getModelPath(SIGLIP_TEXT_MODEL_ID, controller.signal)) ??
              (() => {
                throw new Error('Natural-language search model not downloaded');
              })(),
            controller.signal,
          )
        : await (async () => {
            if (!imageSrc || !selectedNode)
              throw new Error('Select an image or enter a description');
            return embed(imageSrc, imageModelPath, controller.signal);
          })();

      const queryImageData =
        !isTextSearch && searchMode === 'near-duplicates' && imageSrc
          ? (imageDataCacheRef.current.get(imageSrc) ?? (await loadImageToImageDataForAI(imageSrc)))
          : undefined;
      if (queryImageData) imageDataCacheRef.current.set(imageSrc, queryImageData);

      const candidates: Array<SimilarityCandidate & { src: string }> = [];
      let scanned = 0;
      for (const [nodeId, candidateNode] of Object.entries(state.document.nodes)) {
        if (controller.signal.aborted) throw new Error('cancelled');
        if (!isTextSearch && nodeId === selectedNode?.id) continue;
        if (candidateNode.kind !== 'shape' || !isImageShape(candidateNode)) continue;
        const src = imageShapeSrc(candidateNode as ShapeNode);
        if (!src) continue;
        if (scanned >= MAX_SIMILAR_CANDIDATES) break;
        scanned++;
        const candidateEmbedding = await embed(src, imageModelPath, controller.signal);
        const candidate: SimilarityCandidate & { src: string } = {
          id: nodeId,
          contentId: nodeId,
          src,
          embedding: candidateEmbedding,
        };
        if (!isTextSearch && searchMode === 'near-duplicates') {
          const candidateImageData =
            imageDataCacheRef.current.get(src) ?? (await loadImageToImageDataForAI(src));
          imageDataCacheRef.current.set(src, candidateImageData);
          candidate.dHash = dHash(candidateImageData);
          candidate.pHash = pHash(candidateImageData);
        }
        candidates.push(candidate);
      }

      setScannedCount(scanned);
      const queryCandidate: (SimilarityCandidate & { src: string }) | null =
        !isTextSearch && selectedNode && imageSrc
          ? {
              id: selectedNode.id,
              contentId: selectedNode.id,
              src: imageSrc,
              embedding: queryEmbedding,
            }
          : null;
      if (queryCandidate && queryImageData) {
        queryCandidate.dHash = dHash(queryImageData);
        queryCandidate.pHash = pHash(queryImageData);
      }
      const ranked =
        queryCandidate && searchMode === 'near-duplicates'
          ? searchNearDuplicates(queryCandidate, candidates, 5)
          : searchSemantic(queryEmbedding, candidates, 5);
      const results: SimilarMatch[] = ranked.map((r) => ({
        nodeId: r.candidate.id as NodeId,
        src: r.candidate.src,
        similarity: r.score,
        lane: r.lane,
      }));

      setMatches(results);
      setStatus('idle');
      announce(
        results.length === 0
          ? 'No other images found in this document'
          : `Found ${results.length} similar image${results.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorMessage(err instanceof Error ? err.message : 'Search failed');
      setStatus('error');
    }
  }, [
    imageSrc,
    selectedNode,
    state.document.nodes,
    embed,
    embedText,
    announce,
    searchMode,
    queryText,
    textModelAvailable,
  ]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  const isSearching = status === 'searching';
  const needsDownload = !modelAvailable && !usingTestEmbedder && status !== 'downloading';
  const needsTextDownload =
    Boolean(queryText.trim()) && modelAvailable && !textModelAvailable && status !== 'downloading';

  return {
    status,
    errorMessage,
    matches,
    scannedCount,
    queryText,
    setQueryText,
    searchMode,
    setSearchMode,
    modelAvailable,
    textModelAvailable,
    downloadProgress,
    isSearching,
    needsDownload,
    needsTextDownload,
    isImage,
    handleSearch,
    handleCancel,
    handleDownload,
    handleCancelDownload,
    handleDownloadTextModel,
  };
}
