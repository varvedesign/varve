/**
 * Chromium launch configuration and the one warm-up load before the scene loop.
 */
import { BASE } from './config.mjs';

/**
 * Chromium exposes `navigator.gpu` on a secure context by default, but with no
 * adapter behind it — and the inference paths ask for a *hardware* adapter
 * (`requireHardwareAdapter: true`), so they get nothing and fall back to CPU
 * WASM, where a depth pass does not finish in any time a capture can wait for.
 *
 * Routing ANGLE through Vulkan surfaces the real GPU in headless: on an AMD
 * iGPU this reports vendor "amd", architecture "rdna-2". SwiftShader also
 * yields an adapter, but a software one the hardware check rejects — so the
 * Vulkan flags are the ones that matter, not merely "some adapter".
 *
 * Only for model runs. GPU rasterization can shift canvas output subtly, and
 * the ordinary scenes are a committed visual baseline that should not move
 * because a capture host happens to have a GPU.
 */
export const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
];

/**
 * One throwaway load before the scene loop.
 *
 * The dev server transforms and pre-bundles the application's module graph on
 * the first request. Paying that cost inside the first scene made the app
 * miss its 120s boot budget intermittently and skip a perfectly capturable
 * scene; warming it once up front makes every scene start from a hot server.
 */
export async function warmUp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: /^new$/i })
      .waitFor({ state: 'visible', timeout: 180000 });
    console.log('dev server warm');
  } catch (err) {
    console.error(`warm-up did not complete (${err instanceof Error ? err.message : err})`);
  } finally {
    await ctx.close();
  }
}
