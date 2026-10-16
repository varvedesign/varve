import type { PrototypeRuntime } from '@varve/prototype';
import {
  applyActionResult as protoApplyActionResult,
  getVariable as protoGetVar,
  handleEvent as protoHandleEvent,
  setVariable as protoSetVar,
} from '@varve/prototype';
import type { SMRuntime } from '@varve/scene';
import { createStateMachineRuntime, getCurrentStateTimelineId, triggerSMEvent } from '@varve/scene';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ActivePrototypeTransition } from '../components/Prototype/usePrototypeTransition';
import { createRuntimeFromDocument, interactionsMapFromDocument } from '../motion/prototypeRuntime';
import { computeSmartAnimateTransition } from '../motion/smartAnimateBridge';
import { getPrimaryStateMachineTimelineId } from '../motion/stateMachineBridge';
import type { EditorState } from './types';

export interface PrototypeContextValue {
  /** Enter/exit prototype mode */
  setPrototypeMode: (active: boolean) => void;
  /** Set prototype data from current document */
  updatePrototypeData: () => void;
  /** Handle a prototype interaction event */
  handlePrototypeEvent: (event: unknown) => void;
  /** Get prototype variable value */
  getPrototypeVariable: (id: string) => string | number | boolean | undefined;
  /**
   * Set a prototype variable value **in the running session only**.
   *
   * The session is isolated: a prototype interaction must not rewrite the
   * document's authored variable defaults, must not create an undo entry and
   * must not mark the document dirty. Changing an authored default is an
   * explicit editing action in the Variables panel, not a side effect of
   * playback.
   */
  setPrototypeVariable: (id: string, value: string | number | boolean) => void;
  /** Start presentation mode (fullscreen) */
  startPresentation: () => void;
  /** Stop presentation mode */
  stopPresentation: () => void;
  /** Restart the running flow at its entry point. */
  restartPrototype: () => void;
  /** Get all frame nodes (screens) for prototype */
  getPrototypeScreens: () => Array<{ id: string; name: string }>;
  /** Current screen in prototype */
  prototypeCurrentScreen: string;
  /** Navigate to a prototype screen */
  navigatePrototypeTo: (screenId: string) => void;
  /** Authored navigation history depth (0 when there is nowhere to go back to). */
  prototypeHistoryDepth: number;
  /** Walk authored history back one step (overlay first, then screen). */
  prototypeGoBack: () => void;
  /** Whether the viewer draws active-region hints. */
  prototypeShowHotspots: boolean;
  /** Toggle the viewer's active-region hints. */
  togglePrototypeHotspots: () => void;
  /** Active screen transition during prototype navigation. */
  prototypeTransition: ActivePrototypeTransition | null;
  clearPrototypeTransition: () => void;
  /** Flow-view / inspector focus for a prototype interaction. */
  selectedInteractionId: string | null;
  selectPrototypeInteraction: (nodeId: string, interactionId: string) => void;
}

const PrototypeCtx = createContext<PrototypeContextValue | null>(null);

export function usePrototype(): PrototypeContextValue {
  const ctx = useContext(PrototypeCtx);
  if (!ctx) throw new Error('usePrototype must be used within EditorProvider');
  return ctx;
}

interface PrototypeProviderProps {
  children: ReactNode;
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  stateRef: React.MutableRefObject<EditorState>;
  /** Shared refs — kept in the parent so the delay-polling useEffect can access them. */
  prototypeRuntimeRef: React.MutableRefObject<PrototypeRuntime | null>;
  smRuntimeRef: React.MutableRefObject<SMRuntime | null>;
  /**
   * Drives timeline playback when a prototype action starts/stops an animation.
   * Injected from the sibling MotionProvider (via EditorProvider's motion value)
   * so this provider stays free of direct MotionFacade imports. Defaults to no-ops.
   */
  playTimeline?: (timelineId?: string) => void;
  stopTimeline?: () => void;
  onReady?: (value: PrototypeContextValue) => void;
}

export function PrototypeProvider({
  children,
  state,
  setState,
  stateRef,
  prototypeRuntimeRef,
  smRuntimeRef,
  playTimeline = () => {},
  stopTimeline = () => {},
  onReady,
}: PrototypeProviderProps) {
  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [setState],
  );

  const prototypeSmartAnimateRef = useRef<ReturnType<typeof computeSmartAnimateTransition> | null>(
    null,
  );
  const [prototypeTransition, setPrototypeTransition] = useState<ActivePrototypeTransition | null>(
    null,
  );
  const [prototypeCurrentScreen, setPrototypeCurrentScreen] = useState('');
  const [prototypeHistoryDepth, setPrototypeHistoryDepth] = useState(0);
  const [prototypeShowHotspots, setPrototypeShowHotspots] = useState(false);
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);

  /** Mirror the runtime's authored history depth into React state. */
  const syncHistoryDepth = useCallback(() => {
    const runtime = prototypeRuntimeRef.current;
    if (!runtime) {
      setPrototypeHistoryDepth(0);
      return;
    }
    setPrototypeHistoryDepth(runtime.screenHistory.length + runtime.state.overlayStack.length);
  }, [prototypeRuntimeRef]);

  const setPrototypeMode = useCallback(
    (active: boolean) => {
      patch({ prototypeMode: active });
      if (active) {
        const doc = stateRef.current.document;
        const { runtime, entryScreenId } = createRuntimeFromDocument(doc);
        prototypeRuntimeRef.current = runtime;
        const smIds = Object.keys(doc.stateMachines ?? {});
        smRuntimeRef.current = smIds[0] ? createStateMachineRuntime(doc, smIds[0]) : null;
        patch({
          prototypeRuntime: runtime,
          prototypeData: {
            interactions: interactionsMapFromDocument(doc),
          },
        });
        setPrototypeCurrentScreen(entryScreenId);
        setPrototypeHistoryDepth(0);
      } else {
        prototypeRuntimeRef.current = null;
        smRuntimeRef.current = null;
        patch({ prototypeRuntime: null });
        setPrototypeHistoryDepth(0);
      }
    },
    [patch, stateRef, prototypeRuntimeRef, smRuntimeRef],
  );

  const updatePrototypeData = useCallback(() => {
    const { runtime, entryScreenId } = createRuntimeFromDocument(stateRef.current.document);
    prototypeRuntimeRef.current = runtime;
    patch({
      prototypeRuntime: runtime,
      prototypeData: {
        interactions: interactionsMapFromDocument(stateRef.current.document),
      },
    });
    setPrototypeCurrentScreen(entryScreenId);
  }, [patch, stateRef, prototypeRuntimeRef]);

  const handlePrototypeEvent = useCallback(
    (event: unknown) => {
      const runtime = prototypeRuntimeRef.current;
      if (!runtime) return;
      const fromScreenId = runtime.state.currentScreenId;
      const results = protoHandleEvent(runtime, event as Parameters<typeof protoHandleEvent>[1]);
      for (const result of results) {
        for (const actionResult of result.actionResults) {
          if (actionResult.kind === 'navigateTo') {
            const transition = actionResult.transition;
            let smartValues:
              | Record<string, import('@varve/prototype').SmartAnimateLayerValues>
              | undefined;
            if (transition.kind === 'smartAnimate') {
              const sa = computeSmartAnimateTransition(
                stateRef.current.document,
                fromScreenId,
                actionResult.targetId,
              );
              prototypeSmartAnimateRef.current = sa;
              smartValues = sa?.values;
            }
            if (transition.kind !== 'instant') {
              setPrototypeTransition({
                fromScreenId,
                toScreenId: actionResult.targetId,
                transition,
                smartAnimateValues: smartValues,
                layerMatches: prototypeSmartAnimateRef.current?.matches,
                startedAt: performance.now(),
              });
            }
          }
          protoApplyActionResult(runtime, actionResult);

          // Prototype-triggered timeline playback. The @varve/prototype runtime
          // only records animation state; driving the actual MotionFacade
          // playback lives here so the prototype runtime stays document/test
          // agnostic. `animationId` references Document.timelines[id].
          if (actionResult.kind === 'startAnimation') {
            if (stateRef.current.document.timelines?.[actionResult.animationId]) {
              playTimeline(actionResult.animationId);
            }
          } else if (actionResult.kind === 'stopAnimation') {
            stopTimeline();
          }
        }
      }

      if (smRuntimeRef.current) {
        const ev = event as { type?: string };
        if (ev.type === 'click') {
          smRuntimeRef.current = triggerSMEvent(smRuntimeRef.current, 'onClick');
          const tlId = getCurrentStateTimelineId(smRuntimeRef.current);
          if (tlId) {
            patch({
              motion: { ...stateRef.current.motion, activeTimelineId: tlId, currentTime: 0 },
            });
          }
        }
      }

      setPrototypeCurrentScreen(runtime.state.currentScreenId);
      syncHistoryDepth();
    },
    [
      patch,
      stateRef,
      prototypeRuntimeRef,
      smRuntimeRef,
      playTimeline,
      stopTimeline,
      syncHistoryDepth,
    ],
  );

  const getPrototypeVariable = useCallback(
    (id: string) => {
      const runtime = prototypeRuntimeRef.current;
      if (!runtime) return undefined;
      return protoGetVar(runtime, id);
    },
    [prototypeRuntimeRef],
  );

  /**
   * Session-local variable write.
   *
   * This deliberately does **not** call `updateDoc`. The document holds the
   * authored defaults for a variable; a prototype session holds the values the
   * viewer is exercising. Projecting a session write back into the document
   * made playback mutate authored state, produce an undo entry per interaction
   * and mark the document dirty — an observation matching an external report
   * of prototype scrubs creating an undo entry per frame. Editing an authored
   * default is the Variables panel's job, inside a real transaction.
   */
  const setPrototypeVariable = useCallback(
    (id: string, value: string | number | boolean) => {
      const runtime = prototypeRuntimeRef.current;
      if (runtime) protoSetVar(runtime, id, value);
    },
    [prototypeRuntimeRef],
  );

  /**
   * Enter presentation. The session gets its own runtime; the document is not
   * written to. (This previously called `updateDoc(setActiveTimeline)` to
   * point the document at a state-machine timeline. Authoring state must not
   * move because a viewer opened, so the timeline pointer stays where the
   * author left it and only the runtime conveniences are established here.)
   */
  const startPresentation = useCallback(() => {
    const doc = stateRef.current.document;
    const { runtime, entryScreenId } = createRuntimeFromDocument(doc);
    prototypeRuntimeRef.current = runtime;
    const smIds = Object.keys(doc.stateMachines ?? {});
    smRuntimeRef.current = smIds[0] ? createStateMachineRuntime(doc, smIds[0]) : null;
    const smTimelineId = getPrimaryStateMachineTimelineId(doc);
    patch({
      isPresenting: true,
      prototypeRuntime: runtime,
      prototypeData: {
        interactions: interactionsMapFromDocument(doc),
      },
      ...(smTimelineId
        ? {
            motion: {
              ...stateRef.current.motion,
              activeTimelineId: smTimelineId,
              currentTime: 0,
              isPlaying: false,
            },
          }
        : {}),
    });
    setPrototypeCurrentScreen(entryScreenId);
    setPrototypeHistoryDepth(0);
  }, [patch, stateRef, prototypeRuntimeRef, smRuntimeRef]);

  const stopPresentation = useCallback(() => {
    patch({ isPresenting: false });
  }, [patch]);

  /** Restart the flow from its entry point without touching authored state. */
  const restartPrototype = useCallback(() => {
    const { runtime, entryScreenId } = createRuntimeFromDocument(stateRef.current.document);
    prototypeRuntimeRef.current = runtime;
    patch({
      prototypeRuntime: runtime,
      prototypeData: {
        interactions: interactionsMapFromDocument(stateRef.current.document),
      },
    });
    setPrototypeCurrentScreen(entryScreenId);
    setPrototypeHistoryDepth(0);
    setPrototypeTransition(null);
  }, [patch, stateRef, prototypeRuntimeRef]);

  const getPrototypeScreens = useCallback(() => {
    return Object.values(state.document.nodes)
      .filter((n): n is import('@varve/scene').FrameNode => n.kind === 'frame')
      .map((n) => ({ id: n.id, name: n.name }));
  }, [state.document.nodes]);

  /**
   * Inspection navigation (flow view, previous/next screen). This is *not*
   * authored navigation: it deliberately does not push the authored history
   * stack, so the viewer's Back control keeps describing where the flow has
   * actually been. (It previously mutated `runtime.state.currentScreenId`
   * directly, which also meant `goBack` popped an entry the user never
   * created.)
   */
  const navigatePrototypeTo = useCallback(
    (screenId: string) => {
      const runtime = prototypeRuntimeRef.current;
      if (runtime) {
        runtime.state.currentScreenId = screenId;
      }
      setPrototypeCurrentScreen(screenId);
      syncHistoryDepth();
    },
    [prototypeRuntimeRef, syncHistoryDepth],
  );

  /** Walk authored history back one step: top overlay first, then screen. */
  const prototypeGoBack = useCallback(() => {
    const runtime = prototypeRuntimeRef.current;
    if (!runtime) return;
    const fromScreenId = runtime.state.currentScreenId;
    protoApplyActionResult(runtime, { kind: 'goBack' });
    const toScreenId = runtime.state.currentScreenId;
    if (toScreenId !== fromScreenId) {
      setPrototypeTransition({
        fromScreenId,
        toScreenId,
        transition: { kind: 'instant', duration: 0, easing: { kind: 'linear' } },
        startedAt: performance.now(),
      });
    }
    setPrototypeCurrentScreen(toScreenId);
    syncHistoryDepth();
  }, [prototypeRuntimeRef, syncHistoryDepth]);

  const togglePrototypeHotspots = useCallback(() => {
    setPrototypeShowHotspots((visible) => !visible);
  }, []);

  const clearPrototypeTransition = useCallback(() => setPrototypeTransition(null), []);

  const selectPrototypeInteraction = useCallback(
    (nodeId: string, interactionId: string) => {
      setSelectedInteractionId(interactionId);
      patch({ selection: [nodeId] });
    },
    [patch],
  );

  const value = useMemo<PrototypeContextValue>(
    () => ({
      setPrototypeMode,
      updatePrototypeData,
      handlePrototypeEvent,
      getPrototypeVariable,
      setPrototypeVariable,
      startPresentation,
      stopPresentation,
      restartPrototype,
      getPrototypeScreens,
      prototypeCurrentScreen,
      navigatePrototypeTo,
      prototypeHistoryDepth,
      prototypeGoBack,
      prototypeShowHotspots,
      togglePrototypeHotspots,
      prototypeTransition,
      clearPrototypeTransition,
      selectedInteractionId,
      selectPrototypeInteraction,
    }),
    [
      setPrototypeMode,
      updatePrototypeData,
      handlePrototypeEvent,
      getPrototypeVariable,
      setPrototypeVariable,
      startPresentation,
      stopPresentation,
      restartPrototype,
      getPrototypeScreens,
      prototypeCurrentScreen,
      navigatePrototypeTo,
      prototypeHistoryDepth,
      prototypeGoBack,
      prototypeShowHotspots,
      togglePrototypeHotspots,
      prototypeTransition,
      clearPrototypeTransition,
      selectedInteractionId,
      selectPrototypeInteraction,
    ],
  );

  useEffect(() => {
    onReady?.(value);
  }, [value, onReady]);

  return <PrototypeCtx.Provider value={value}>{children}</PrototypeCtx.Provider>;
}
