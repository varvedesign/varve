import {
  classifyRun,
  measuredTraceFailure,
  performanceEvidence,
  summarizeRunnerTraces,
  worstValidity,
} from '../productionEvidence.mjs';
import {
  FIXTURE,
  MEASURED_ATTEMPTS,
  MEASUREMENT_TRACE_KINDS,
  MIN_WARM_SAMPLES,
  PREVIEW_QUALITY,
  RENDERER_MODE,
  WARMUP,
  WORKLOADS,
} from './cli.mjs';
import {
  contentCanvasDigest,
  drainInteractionTraces,
  summarizeRendererFrames,
} from './evidence.mjs';
import { driveWorkload } from './gestures.mjs';
import { CPU_COUNT, captureMachineState } from './machineState.mjs';
import { resolveDragTarget } from './scenarios.mjs';
import { browser } from './session.mjs';

export async function runMeasurementLoop({
  baselineSceneFingerprint,

  box,

  exitCode,

  page,

  partial,

  rendererAvailable,

  restoreBaselineCamera,

  scene,

  server,
}) {
  for (const workload of rendererAvailable ? WORKLOADS : []) {
    const browserPid = browser?.process?.()?.pid;
    const beforeState = captureMachineState([process.pid, server?.pid, browserPid]);
    const record = {
      workload,
      previewQuality: PREVIEW_QUALITY,
      warmupIterations: WARMUP,
      measuredIterations: MEASURED_ATTEMPTS,
      machineBefore: beforeState,
      validity: classifyRun(beforeState, null, null, CPU_COUNT),
    };
    let coldFirstStroke = null;
    try {
      if (['brush', 'brush-large-tip', 'eraser'].includes(workload)) {
        await restoreBaselineCamera();
        await driveWorkload(page, box, workload, -1, scene.dragTarget);
        await restoreBaselineCamera();
        if ((await contentCanvasDigest(page)) !== baselineSceneFingerprint) {
          throw new Error('cold first stroke did not restore the fixture scene and camera');
        }
        await page.waitForTimeout(300);
        const coldTraces = new Map();
        await drainInteractionTraces(page, coldTraces, workload);
        coldFirstStroke =
          [...coldTraces.values()].find((trace) => trace.kind === 'pointer') ?? null;
        await page.evaluate(() => window.__varvePerf?.interactions?.reset?.());
      }
      // Warm-up is separated from measurement: JIT, font and shader
      // initialisation are one-time costs and must not enter the distribution.
      for (let i = 0; i < WARMUP; i++) {
        await restoreBaselineCamera();
        await driveWorkload(
          page,
          box,
          workload,
          i,
          scene.dragTarget,
          workload === 'single-drag' ? baselineSceneFingerprint : null,
        );
      }
      // A drag settles the node's selection box with its centre at the drag
      // point; the measured iterations re-resolve the drag target from the
      // current box so a drag never starts on a selection handle.
      if (FIXTURE) {
        const settled = await resolveDragTarget(page, scene.dragTarget);
        scene.dragTarget = settled;
        partial.fixtureDragTarget = settled;
      }
      await restoreBaselineCamera();
      if ((await contentCanvasDigest(page)) !== baselineSceneFingerprint) {
        throw new Error('warm-up did not restore the fixture scene and camera');
      }

      await page.evaluate(() => {
        const perf = window.__varvePerf;
        perf?.reset?.();
        perf?.interactions?.reset?.();
        perf?.nodeWork?.reset?.();
      });
      const measurementSeedOracle = await page.evaluate(async () =>
        window.__varvePerf?.forceFullRedraw?.(),
      );
      if (measurementSeedOracle?.authoritative !== true) {
        throw new Error('measurement baseline did not produce an authoritative full redraw');
      }
      await page.evaluate(() => window.__varvePerf?.nodeWork?.reset?.());

      const inputCountsAtStart = await page.evaluate(() => ({
        trusted: window.__varveQualificationInput?.trusted ?? 0,
        untrusted: window.__varveQualificationInput?.untrusted ?? 0,
      }));

      const collectedTraces = new Map();
      const heapSamples = [];
      for (let i = 0; i < MEASURED_ATTEMPTS; i++) {
        // Re-resolve from the settled selection box right before each drag so
        // the pointer never starts on a selection handle (a drag moves the
        // node's centre to the click point).
        if (FIXTURE && workload !== 'zoom') {
          scene.dragTarget = await resolveDragTarget(page, scene.dragTarget);
        }
        await driveWorkload(
          page,
          box,
          workload,
          i,
          scene.dragTarget,
          workload === 'single-drag' ? baselineSceneFingerprint : null,
        );
        await restoreBaselineCamera();
        if ((await contentCanvasDigest(page)) !== baselineSceneFingerprint) {
          throw new Error(`gesture ${i} did not restore the original scene/camera`);
        }
        // Forced GC is a benchmark-only capability (--expose-gc) and is never
        // available in production; sampling after it isolates retained heap
        // from collectable garbage.
        const heap = await page.evaluate(() => {
          if (typeof globalThis.gc !== 'function') return null;
          globalThis.gc();
          return performance.memory?.usedJSHeapSize ?? null;
        });
        if (heap !== null) heapSamples.push(heap);
        await drainInteractionTraces(page, collectedTraces, workload);
      }

      // Event Timing and the final authoritative frame can arrive after the
      // last input task. Allow the bounded browser ring to settle before the
      // runner classifies missing evidence.
      await page.waitForTimeout(300);
      await drainInteractionTraces(page, collectedTraces, workload);

      const measured = await page.evaluate(() => {
        const perf = window.__varvePerf;
        const traces = perf?.interactions?.getTraces?.(50) ?? [];
        const distribution = (values) => {
          const sorted = [...values].sort((a, b) => a - b);
          const at = (percent) => {
            if (sorted.length === 0) return null;
            return sorted[Math.ceil((percent / 100) * sorted.length) - 1];
          };
          return {
            count: sorted.length,
            p50: at(50),
            p75: at(75),
            p90: at(90),
            p95: at(95),
            p99: at(99),
            max: sorted.at(-1) ?? null,
          };
        };
        const spanDurations = {};
        const traceKinds = {};
        const frameDispositions = {};
        const frameTotals = [];
        let droppedSpans = 0;
        let droppedFrames = 0;
        for (const trace of traces) {
          traceKinds[trace.kind] = (traceKinds[trace.kind] ?? 0) + 1;
          droppedSpans += trace.droppedSpanCount ?? 0;
          droppedFrames += trace.droppedFrameCount ?? 0;
          for (const span of trace.spans ?? []) {
            const durations = spanDurations[span.name] ?? [];
            durations.push(span.durationMs);
            spanDurations[span.name] = durations;
          }
          for (const frame of trace.frames ?? []) {
            const disposition = frame.causalRelation ?? frame.disposition ?? 'unspecified';
            frameDispositions[disposition] = (frameDispositions[disposition] ?? 0) + 1;
            frameTotals.push(frame.totalMs);
          }
        }
        return {
          interactions: perf?.interactions?.summary?.() ?? null,
          traceCount: perf?.interactions?.count?.() ?? 0,
          interactionBreakdown: {
            traceKinds,
            spans: Object.fromEntries(
              Object.entries(spanDurations).map(([name, values]) => [name, distribution(values)]),
            ),
            frameDispositions,
            frameTotal: distribution(frameTotals),
            droppedSpans,
            droppedFrames,
          },
          nodeWork: perf?.nodeWork?.getSamples?.(30) ?? null,
          frames: perf?.getFrames?.(120) ?? null,
          workerBitmapBudget: perf?.workerBitmapBudget?.() ?? null,
          clockCalibration: perf?.clockCalibration?.() ?? null,
          presentation: perf?.presentation?.() ?? null,
          rendererQualification: {
            requested: perf?.getFrames?.(1)?.at(-1)?.requestedRenderer ?? null,
            actual: perf?.getFrames?.(120)?.at(-1)?.actualDrawingPath ?? null,
          },
          trustedInput: window.__varveQualificationInput ?? null,
        };
      });
      measured.rendererQualification.frameSummary = summarizeRendererFrames(measured.frames ?? []);
      measured.trustedInput = {
        ...measured.trustedInput,
        measuredTrusted: (measured.trustedInput?.trusted ?? 0) - inputCountsAtStart.trusted,
        measuredUntrusted: (measured.trustedInput?.untrusted ?? 0) - inputCountsAtStart.untrusted,
      };
      const allCollectedTraces = [...collectedTraces.values()];
      const expectedTraceKinds = MEASUREMENT_TRACE_KINDS[workload] ?? null;
      const measuredTraces = expectedTraceKinds
        ? allCollectedTraces.filter((trace) => expectedTraceKinds.includes(trace.kind))
        : allCollectedTraces;
      const measuredTraceKeys = new Set(
        measuredTraces.map((trace) => `${trace.sessionId ?? 'session'}:${trace.id}`),
      );
      const traceSummary = summarizeRunnerTraces(measuredTraces);
      Object.assign(record, measured, traceSummary, {
        allTraceCount: allCollectedTraces.length,
        measurementTraceKinds: expectedTraceKinds ?? ['all-observed'],
        heapSamples,
        coldFirstStroke,
        status: 'ok',
        scenePixelsSha256: baselineSceneFingerprint,
        rawSamples: allCollectedTraces.map((trace) => ({
          id: trace.id,
          sessionId: trace.sessionId,
          kind: trace.kind,
          measurementSelected: measuredTraceKeys.has(`${trace.sessionId ?? 'session'}:${trace.id}`),
          inputToCommitMs: trace.inputToCommitMs ?? null,
          inputToNextPaintMs: trace.inputToNextPaintMs ?? null,
          timestampSource: trace.timestampSource ?? null,
          presentationEvidence: trace.presentationEvidence ?? null,
          initialQueueDelayMs: trace.initialQueueDelayMs ?? null,
          spans: (trace.spans ?? []).map((span) => ({
            name: span.name,
            durationMs: span.durationMs,
            queueDelayMs: span.attributes?.queueDelayMs ?? null,
            eventSequenceId: span.attributes?.eventSequenceId ?? null,
          })),
        })),
      });
      const pathCounts = record.rendererQualification?.frameSummary?.actualPathCounts ?? {};
      const expectedPaths =
        RENDERER_MODE === 'webgl2'
          ? ['webgl2', 'webgl2-mixed']
          : RENDERER_MODE === 'canvas2d-worker'
            ? ['canvas2d-worker']
            : ['canvas2d-main'];
      record.rendererModeVerified = expectedPaths.some((path) => (pathCounts[path] ?? 0) > 0);
      if (!record.rendererModeVerified) {
        record.status = 'renderer-path-lost';
        record.error = `measured frames did not use requested mode ${RENDERER_MODE}`;
      }
      record.machineAfter = captureMachineState([process.pid, server?.pid, browserPid]);
      const evidence = performanceEvidence(
        measuredTraces,
        {
          ...partial,
          ...record,
          fixture: partial.fixture,
          sceneNodeCount: partial.sceneNodeCount,
        },
        MIN_WARM_SAMPLES,
      );
      record.evidence = {
        ...evidence,
        collectedTraceCount: measuredTraces.length,
        allCollectedTraceCount: allCollectedTraces.length,
        requiredWarmSamples: MIN_WARM_SAMPLES,
      };
      record.performanceOutcome = evidence.performanceOutcome;
      record.promotionEligible = evidence.promotionEligible;
      record.promotionBlockers = evidence.promotionBlockers;
      record.runtimeErrors = [...partial.runtimeErrors];
      const reportedRenderer = String(partial.webglRuntimeEvidence?.glRenderer ?? '');
      const softwareRenderer =
        partial.webglRuntimeEvidence?.softwareRendering === true ||
        /(swiftshader|llvmpipe|lavapipe|softpipe|swrast|software raster)/i.test(reportedRenderer);
      record.rendererExecution = {
        reportedRenderer: reportedRenderer || null,
        hardwareExecution: 'unknown',
        compatibilityOnly: softwareRenderer,
      };
      const evidenceForValidity = {
        insufficientSamples: evidence.insufficientSamples,
        presentationUnavailable: evidence.presentationUnavailable,
        thresholdBreaches: evidence.thresholdBreaches,
        softwareRenderer,
        instrumentationError:
          partial.runtimeErrors.length > 0 ||
          (record.interactionBreakdown?.instrumentationErrors ?? 0) > 0 ||
          (record.interactionBreakdown?.missingPresentation ?? 0) > 0,
      };
      record.validity = worstValidity(
        classifyRun(beforeState, partial.identity, null, CPU_COUNT),
        classifyRun(record.machineAfter, partial.identity, evidenceForValidity, CPU_COUNT),
      );
      if (softwareRenderer) record.validity = worstValidity(record.validity, 'software_renderer');
      if ((record.trustedInput?.measuredUntrusted ?? 0) > 0) {
        record.validity = worstValidity(record.validity, 'instrumentation_error');
      }
      if (!record.rendererModeVerified) {
        record.validity = worstValidity(record.validity, 'instrumentation_error');
      }
      if (record.runtimeErrors.length > 0) {
        record.status = 'runtime-error';
        record.error = `benchmark page emitted ${record.runtimeErrors.length} console or page error(s)`;
        record.performanceOutcome = 'invalid-run';
        record.promotionEligible = false;
        record.promotionBlockers = [
          ...new Set([...(record.promotionBlockers ?? []), 'runtime-errors']),
        ];
      }

      // Measurement availability and measured performance are separate:
      // valid slow traces remain usable for choosing a baseline target.
      const traceFailure = measuredTraceFailure(
        workload,
        measuredTraces.length,
        record.interactionBreakdown?.missingPresentation ?? 0,
      );
      if (traceFailure) {
        record.status = traceFailure.status;
        record.error = traceFailure.error;
      }
      if (record.validity !== 'valid' || record.status !== 'ok') exitCode = 1;
    } catch (error) {
      // One failed workload must not lose the others.
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
    }
    partial.workloads.push(record);
    const inputToCommit = record.interactions?.inputToCommit;
    const inputToCommitP95 = inputToCommit?.count
      ? `${inputToCommit.p95.toFixed(1)}ms (${inputToCommit.count} samples)`
      : 'n/a (0 samples)';
    const summary = record.interactions
      ? `commit p95 ${inputToCommitP95}, ${record.traceCount} traces`
      : '';
    console.log(`  ${workload}: ${record.status}${summary}`);
  }

  return exitCode;
}
