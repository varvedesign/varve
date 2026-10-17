# Native raster and detached Canvas2D baseline (2026-10-17)

This is a six-case, single-host microbenchmark comparison. It validates that
the two harnesses exercise matching deterministic scene corpora; it does not
measure editor frame time, compositor presentation, input latency, or visual
parity. Do not use it as a product speedup claim.

## Environment and method

- Host: CachyOS Linux x86_64, AMD Ryzen 3 5300U / AMD Radeon Graphics (RADV
  Renoir), Vulkan, Wayland; native MSAA 4×.
- Native: release `varve-accel` benchmark, 60 warm frames per case. The timed
  total contains one `render` call; IR lowering is timed separately.
- Browser: Chromium 151.0.7922.34, Node 22.23.2; detached Canvas2D replay,
  full clear, and full-frame `getImageData` readback in the timed interval;
  60 warm frames per case. Each output passed a 5% nontransparent-pixel smoke
  threshold.
- Six cases: 1600×1000, 2560×1600, and 3200×2000, each with 600 and 10,000
  items. Both consume the same generated corpus. These were separate runs,
  not synchronized or interleaved; machine load can change the result.

## Results

Milliseconds per frame. `Canvas2D` includes draw replay, clear, and readback;
native `render` includes its renderer and readback/conversion work. The stages
and presentation boundaries differ, so compare these as harness outputs only.

| Canvas size | Items | Canvas2D p50 | Canvas2D p95 | Native total p50 | Native total p95 |
|---|---:|---:|---:|---:|---:|
| 1600×1000 | 600 | 37.0 | 107.1 | 11.29 | 13.98 |
| 1600×1000 | 10,000 | 237.6 | 387.4 | 96.77 | 129.66 |
| 2560×1600 | 600 | 36.2 | 48.9 | 18.72 | 21.77 |
| 2560×1600 | 10,000 | 165.4 | 248.6 | 104.44 | 188.04 |
| 3200×2000 | 600 | 51.2 | 104.3 | 24.26 | 26.29 |
| 3200×2000 | 10,000 | 261.8 | 342.2 | 110.29 | 146.55 |

Native p50 stage timings (lower / encode / transfer / straighten), in ms:

| Size / items | Lower | Encode | Transfer | Straighten |
|---|---:|---:|---:|---:|
| 1600×1000 / 600 | 0.20 | 0.03 | 7.31 | 2.91 |
| 1600×1000 / 10,000 | 4.05 | 0.40 | 77.79 | 4.75 |
| 2560×1600 / 600 | 0.19 | 0.03 | 11.19 | 6.76 |
| 2560×1600 / 10,000 | 3.94 | 0.39 | 82.84 | 9.31 |
| 3200×2000 / 600 | 0.20 | 0.03 | 13.80 | 9.77 |
| 3200×2000 / 10,000 | 3.99 | 0.42 | 84.30 | 13.33 |

The native breakdown shows command recording and lowering are small relative to
GPU completion/readback for this corpus. The detached Canvas2D path is also
costly at these dimensions. Neither fact establishes which path produces a
better interactive presentation: Canvas2D's readback is not part of the normal
editor replay, and native output is still copied back to the webview rather
than presented directly.

## Reproduction

```bash
cargo run --release --locked -p varve-accel --example native_render_bench -- \
  --emit-corpus /tmp/varve-baseline
VARVE_BENCH_FRAMES=60 cargo run --release --locked -p varve-accel \
  --example native_render_bench
VARVE_CANVAS2D_BASELINE=/tmp/varve-baseline VARVE_BASELINE_FRAMES=60 \
  node scripts/quality/heavy-lease.mjs 'e2e: six-case Canvas2D native baseline' -- \
  npx playwright test tests/e2e/perf/canvas2d-native-baseline.spec.ts \
    --config playwright.inference-probe.config.ts --project=chromium \
    --workers=1 --reporter=list
```

Artifacts from the recorded run are in the local ignored
`reports/native-raster-baseline/` directory; only the methodology and summary
are committed here.
