import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { run } from './machineState.mjs';

/** Provenance: a result without this is informational only, never a budget. */
export function buildIdentity() {
  return {
    commit: run('git', ['rev-parse', 'HEAD'], 'unknown'),
    commitShort: run('git', ['rev-parse', '--short', 'HEAD'], 'unknown'),
    branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
    // A dirty tree means the artifact does not correspond to the commit.
    dirty: (run('git', ['status', '--porcelain'], '') ?? '').length > 0,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    os: run('uname', ['-sr'], 'unknown'),
    cpuModel: (
      run('sh', ['-c', "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2"], '') ?? ''
    ).trim(),
    cpuCount: run('nproc', [], 'unknown'),
    memTotalKb: (
      run('sh', ['-c', "grep MemTotal /proc/meminfo | awk '{print $2}'"], '') ?? ''
    ).trim(),
    cpuGovernor: run(
      'sh',
      ['-c', 'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null'],
      'unknown',
    ),
    sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
    capturedAt: new Date().toISOString(),
  };
}

export function hashDirectory(directory) {
  const hash = createHash('sha256');
  const visit = (path, relative = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = `${path}/${entry.name}`;
      const childRelative = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(child, childRelative);
      else {
        hash.update(childRelative);
        hash.update(readFileSync(child));
      }
    }
  };
  visit(directory);
  return hash.digest('hex');
}

export async function readChromiumGpuDiagnostics(browser) {
  let session;
  try {
    session = await browser.newBrowserCDPSession();
    const info = await session.send('SystemInfo.getInfo');
    const gpu = info?.gpu ?? {};
    return {
      source: 'Chrome DevTools SystemInfo.getInfo',
      softwareRendering: gpu.auxAttributes?.softwareRendering ?? null,
      glVendor: gpu.auxAttributes?.glVendor ?? null,
      glRenderer: gpu.auxAttributes?.glRenderer ?? null,
      glVersion: gpu.auxAttributes?.glVersion ?? null,
      featureStatus: gpu.featureStatus ?? null,
      activeDevices: (gpu.devices ?? [])
        .filter((device) => device.active)
        .map(({ vendorId, deviceId, vendorString, deviceString, driverVendor, driverVersion }) => ({
          vendorId,
          deviceId,
          vendorString,
          deviceString,
          driverVendor,
          driverVersion,
        })),
      hardwareExecution: 'unknown; system GPU diagnostics do not prove this run executed there',
    };
  } catch (error) {
    return {
      source: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
      hardwareExecution: 'unknown',
    };
  } finally {
    await session?.detach().catch(() => {});
  }
}

export function rendererModeUrl(base, mode) {
  const url = new URL('/?perf=1', base);
  if (mode === 'canvas2d-main') url.searchParams.set('renderWorker', '0');
  if (mode === 'canvas2d-worker') url.searchParams.set('renderWorker', '1');
  return url.toString();
}

export async function inspectRendererMode(page, mode) {
  const offscreenProbe =
    mode === 'canvas2d-worker'
      ? await page.evaluate(async () => {
          const perf = window.__varvePerf;
          return (await perf?.probeOffscreen?.()) ?? null;
        })
      : null;
  const snapshot = await page.evaluate(() => {
    const perf = window.__varvePerf;
    const frames = perf?.getFrames?.(120) ?? [];
    const recent = frames.at(-1);
    const path = perf?.renderPath?.();
    return {
      frames,
      path,
      latestPath: recent?.actualDrawingPath ?? null,
    };
  });
  const paths = new Set(snapshot.frames.map((frame) => frame.actualDrawingPath).filter(Boolean));
  let available = false;
  let reason = null;
  if (mode === 'canvas2d-main') {
    available = paths.has('canvas2d-main');
    if (!available)
      reason = `main-thread Canvas2D was not observed (${snapshot.latestPath ?? 'no frame'})`;
  } else if (mode === 'canvas2d-worker') {
    available =
      snapshot.path?.offscreenCanvasVerified === true &&
      snapshot.path?.workerHostCreated === true &&
      paths.has('canvas2d-worker');
    if (!available) reason = snapshot.path?.summary ?? 'verified Canvas2D worker frame unavailable';
  } else {
    available = paths.has('webgl2') || paths.has('webgl2-mixed');
    if (!available)
      reason = `WebGL2 actual drawing path was not observed (${snapshot.latestPath ?? 'no frame'})`;
  }
  return {
    requestedMode: mode,
    available,
    reason,
    actualPaths: [...paths],
    workerProbe: snapshot.path
      ? {
          offscreenCanvasVerified: snapshot.path.offscreenCanvasVerified,
          workerHostCreated: snapshot.path.workerHostCreated,
          fallbackReason: snapshot.path.fallbackReason,
        }
      : null,
    offscreenProbe,
    webgl2: {
      contextAvailable: mode === 'webgl2' ? available : null,
      vendor: null,
      renderer: null,
      hardwareExecution: 'unknown',
      diagnosticsSource: 'native-webview diagnostics not available from Chromium screening runner',
    },
  };
}

export async function contentCanvasDigest(page) {
  return page.locator('canvas.editor-canvas__content-layer').evaluate(async (canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('content canvas is missing');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('content canvas pixels are not readable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  });
}

/**
 * History shortcuts are captured at window level before the canvas keyboard
 * trace handler runs, so undo is not guaranteed to create a keyboard trace.
 * Verify restoration from the pixels themselves, then ask the independent
 * full-redraw oracle to confirm those pixels still match the authoritative
 * document state. The preceding drag must already have changed the digest,
 * which prevents accepting an old baseline surface before undo commits.
 */
export async function waitForAuthoritativeCanvasDigest(page, expectedDigest, label) {
  const deadline = Date.now() + 5_000;
  let lastDigest = null;
  while (Date.now() < deadline) {
    lastDigest = await contentCanvasDigest(page);
    if (lastDigest === expectedDigest) {
      const oracle = await page.evaluate(async () => window.__varvePerf?.forceFullRedraw?.());
      if (oracle?.authoritative === true) {
        lastDigest = await contentCanvasDigest(page);
        if (lastDigest === expectedDigest) return;
      }
    }
    await page.waitForTimeout(50);
  }
  throw new Error(
    `${label} did not restore baseline pixels with an authoritative redraw within 5 seconds; last digest=${lastDigest ?? 'unavailable'}`,
  );
}

export async function readScriptResourceState(page) {
  return page.evaluate(() => {
    globalThis.gc?.();
    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.initiatorType === 'script' || /\.js(?:\?|$)/.test(entry.name))
      .map((entry) => ({
        resource: new URL(entry.name).pathname,
        encodedBytes: entry.encodedBodySize || null,
        decodedBytes: entry.decodedBodySize || null,
        startTimeMs: entry.startTime,
      }));
    return {
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      resources,
    };
  });
}

export function summarizeRendererFrames(frames) {
  const counts = {};
  for (const frame of frames) {
    const path = frame.actualDrawingPath ?? 'unattributed';
    counts[path] = (counts[path] ?? 0) + 1;
  }
  const sum = (key) => frames.reduce((total, frame) => total + (frame[key] ?? 0), 0);
  const distributions = (key) => {
    const values = frames
      .map((frame) => frame[key])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const at = (p) => values[Math.ceil((p / 100) * values.length) - 1] ?? null;
    return { count: values.length, p50: at(50), p95: at(95), max: values.at(-1) ?? null };
  };
  return {
    frameCount: frames.length,
    actualPathCounts: counts,
    visibleItemCount: sum('nodeCount'),
    gpuSubmittedItems: sum('gpuSubmittedItems'),
    fallbackCanvasItems: sum('fallbackCanvasItems'),
    textureUploads: sum('textureUploads'),
    gpuTextureBytesMax: Math.max(0, ...frames.map((frame) => frame.gpuTextureBytes ?? 0)),
    gpuSubmitCpuMs: distributions('gpuSubmitCpuMs'),
    gpuBlitCpuMs: distributions('gpuBlitCpuMs'),
  };
}

export async function latestInteractionTraceId(page) {
  return page.evaluate(() => {
    const traces = window.__varvePerf?.interactions?.getTraces?.(50) ?? [];
    return traces.reduce((latest, trace) => Math.max(latest, trace.id ?? 0), 0);
  });
}

export async function waitForCommittedInteraction(page, kind, afterId, label) {
  try {
    await page.waitForFunction(
      ({ expectedKind, minimumId }) => {
        const traces = window.__varvePerf?.interactions?.getTraces?.(50) ?? [];
        return traces.some(
          (trace) =>
            trace.id > minimumId &&
            trace.kind === expectedKind &&
            trace.inputToCommitMs !== null &&
            trace.frameCount > 0,
        );
      },
      { expectedKind: kind, minimumId: afterId },
      { timeout: 5_000, polling: 'raf' },
    );
  } catch {
    const recent = await page.evaluate(() => {
      const traces = window.__varvePerf?.interactions?.getTraces?.(8) ?? [];
      return traces.map((trace) => ({
        id: trace.id,
        kind: trace.kind,
        inputToCommitMs: trace.inputToCommitMs,
        frameCount: trace.frameCount,
        presentationExpected: trace.presentationExpected,
        instrumentationErrors: trace.instrumentationErrors,
      }));
    });
    throw new Error(
      `${label} interaction did not produce a causally committed frame after trace ${afterId}; recent=${JSON.stringify(recent)}`,
    );
  }
}

/**
 * Drain the bounded in-page ring after each measured gesture. Keeping the
 * aggregate in the runner gives a workload 100+ warm samples without raising
 * the production ring's memory budget. Re-reading an existing id lets a late
 * frame commit update the same trace before the workload completes.
 */
export async function drainInteractionTraces(page, collected, workload = null) {
  const traces = await page.evaluate(() => window.__varvePerf?.interactions?.getTraces?.(50) ?? []);
  for (const trace of traces) {
    if (['brush', 'brush-large-tip', 'eraser'].includes(workload) && trace.kind !== 'pointer') {
      continue;
    }
    collected.set(`${trace.sessionId ?? 'session'}:${trace.id}`, trace);
  }
}
