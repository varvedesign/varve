# AI model reliability — active audit (2026-10-23)

Status: **in progress; no whole-workflow completion claim**. Working branch:
`fix/ai-model-reliability`, initially based on `2646f8850`.

## Acceptance and evidence

Every selectable operation must execute the advertised model/operation and apply
its result. A refusal or silent downgrade does not establish success. Distinguish
missing artifacts, runtime/device limits, and application defects; preserve a
useful recovery path. Verify acquisition, selection, cancellation, execution and
application, including code review and rendered UI checks. Documentation and
website claims must match the evidence.

User clarification: every advertised workflow needs a **real native device
implementation and a usable applied result**. Web paths that cannot execute
reliably must be gated. Production stubs and mock-only evidence do not satisfy
this requirement; test doubles below establish regressions only.

The [prior admission audit](derived-work-admission-defect-2026-10-22.md) contains
retracted memory interpretations and contradictory completion statements. In
particular, its 432 MiB BiRefNet Lite sample was collected **after** inference and
is not a peak. The resulting 450 MB native threshold is unsupported. Historical
7/8.5 GB figures came from native retained-RSS reports, not browser measurements.
The July Lite WASM failures were Node runs near 4027–4145 MB process RSS; RSS is
not WASM linear-memory usage, 4.1 GB is below 4 GiB, and these runs do not prove
Full's requirements. Correct production thresholds after reliable measurement.

Current measurement slice: use approximate Linux `VmHWM` for process-lifetime
high-water RSS and `VmRSS` for post-inference residency, one fresh process per
model, externally corroborated. Keep raw artifacts and distinguish model output
from quality/reference and UI workflow evidence.

Technical references read:

- [Linux proc status counters](https://man7.org/linux/man-pages/man5/proc_pid_status.5.html):
  VmHWM and VmRSS differ; kernel counters are approximate.
- [ORT Web large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html):
  wasm32 address-space and ArrayBuffer restrictions are distinct from host RAM.
- [ORT memory tuning](https://onnxruntime.ai/docs/performance/tune-performance/memory.html):
  retained arenas and session sharing affect memory behavior.

## Confirmed source-level findings awaiting workflow regression evidence

- Native `nativeModelIdForOptions` accepts only each method's default. Explicit
  Full cannot use native inference through this resolver despite the native
  inference module supporting its artifact. The Rust IPC options currently
  omit `modelId`; changing only the TypeScript guard would select the wrong model.
- Dispatch downgrades High quality to Balanced when no `modelId` is supplied,
  after either admission refusal or provider failure.
- Timeout aborts the JavaScript attempt without waiting for native computation
  to stop; native cancellation must be traced before relying on lease release.
- Settings actually mounts `BgRemovalModelsTab` and `ColorizationModelsTab`.
  `ModelManager.tsx` has no discovered importer; do not treat it as the live UI.
- Live model settings leak their loader subscription; composite download errors
  are hidden when `finally` clears `compositeDownload`. Source inspection alone
  is not yet a passing regression test.

The manifest has 41 entries including components and non-executable assets.
An entry is not proof of a reachable supported user workflow. Consumer inventory
and real execution coverage remain in progress.

## Visual research and proposed directions

Research date: **2026-10-23**. Inspected actual official screenshots, not search
snippets. Figma Community scouting returned an HTTP 403 for the discovered
[AI multi-tool listing](https://www.figma.com/community/plugin/1641430761022734370/ai-free-multi-tool-free-no-api-no-login);
its unseen design is not evidence. The installed Impeccable references
`mandatory-research.md` and `figma-community.md` were missing; the standing
AGENTS research/approval gate remains authoritative.

| Inspected source | Observed pattern | Relevance / limit |
|---|---|---|
| [LM Studio model load configuration](https://lmstudio.ai/blog/lmstudio-v0.3.27), [screenshot](https://lmstudio.ai/assets/marketing/blog/load-estimate.png) | Named artifact, prominent estimated memory summary, GPU/total separation, advanced disclosure, explicit Load/Cancel | State uncertainty and current configuration near the action. Do not transfer LLM context controls, GPU promises, or the annotation's magenta outline. |
| [Krita AI Diffusion connection choices](https://docs.interstice.cloud/installation/), [screenshot](https://docs.interstice.cloud/_astro/server-options.D4vKkoI-_ZsqLTX.png) | Distinct backend choices with prerequisites and individual actions in existing settings navigation | Separate runtime capability from installation. Do not introduce accounts, cloud service, or server setup into Varve's local-first operations. |
| [Krita AI Diffusion local installer](https://docs.interstice.cloud/installation/), [screenshot](https://docs.interstice.cloud/_astro/local-install._eOSHG5i_Z12jrv1.png) | Installed/connected state, storage path, device selector, workload/package grouping, install size and VRAM fields, log link | Acquisition and execution readiness are different states; reveal component details when needed. Do not copy its density, arbitrary ratings, native select, or annotated orange boxes. |

Also inspected Varve's committed `high-quality-model-info.png` from October 22
against current sources and DESIGN.md. It is historical visual evidence (its
7 GB browser text is older than the current 4.1 GB text), not current rendered
validation. Varve is a dense desktop/web creative tool; preserve its Geist/Plex
typography, semantic teal/status tokens, themes, shared controls and Inspector.
The external screenshots are inspiration, not usability proof or licensed assets.

Presented routes (all keep existing identity/tokens):

1. **Inline readiness + model details (recommended).** Keep Inspector actions and
   grouped Offline Models rows. Place model/runtime/readiness and one applicable
   recovery action next to the workflow; disclose memory provenance and details.
   Uses LM Studio's action-adjacent estimate and Krita's explicit install states.
   Compact existing typography/density; semantic status color plus text. Progress,
   cancellation and failures stay with their model. Tradeoff: less at-a-glance
   comparison of many models.
2. **Settings-first readiness table.** Consolidate status, artifact size, runtime
   compatibility and memory evidence in the existing Offline Models surface;
   Inspector links directly to the relevant model row. Uses Krita's installer
   grouping and LM Studio's resource summary. Existing font/color tokens with
   denser aligned rows and stacked narrow layouts. Persistent per-row retry and
   cancel. Tradeoff: more navigation to resolve an interrupted edit.
3. **On-demand preparation dialog.** Keep the current compact Inspector; when
   setup is needed, show the chosen model, requirements, install/run steps and
   progress in the existing download-dialog family. Uses LM Studio's pre-load
   panel and Krita's setup choices. Existing modal typography, spacing and teal
   primary action; preserve selection and explicit retry/cancel. Tradeoff: more
   interruptions and less visibility before starting.

**Approval: 2026-10-23, user chose Inline readiness (recommended).** Apply this
route to existing model workflow surfaces; retain incumbent tokens and controls.

## Validation ledger

- `pnpm_config_verify_deps_before_run=false pnpm verify:plan`: seven lanes for
  the benchmark-only change; no full-suite escalation. Website E2E and full
  visual suite skipped as unrelated to that slice.
- `pnpm verify:affected` (same pnpm environment override, shared Cargo target):
  queued Rust checks; emoji audit passed. Touched Biome format/lint had no
  applicable files. This is not a completed validation gate.
- Example regression tests and executable build passed under the shared
  heavy-task lease after the restart: `cargo test -p varve-bgremove --features ai
  --example bgremove_bench` (3/3), then `cargo build -p varve-bgremove --features
  ai --example bgremove_bench`, with the existing shared Cargo target.
- No new native Lite/Full peak run, rendered-UI validation, Windows/macOS or GPU
  validation has completed in this worktree.

### Resume: selection, lifecycle, and cancellation

- Explicit native Full/U2-NetP routing and result provenance: six failures
  reproduced, then 16 focused tests passed. Rust wire/allowlist regressions are
  written; their native gate remains pending.
- High quality no longer downgrades silently to Balanced. Explicit local model
  requests cannot fall through to cloud execution. Four failures reproduced,
  then 23 focused dispatch/admission/cloud tests passed.
- Offline Models subscription/late-init cleanup, unmount cancellation, persistent
  row errors/retry, mutation serialization, and combined component progress:
  six failures reproduced; the first post-fix run timed out. The subsequent
  `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/editor/src/components/Settings/BgRemovalModelsTab.test.tsx
  --maxWorkers=1` passed **14/14** in 113 seconds. Rendered verification remains
  pending.
- Three cancellation regressions reproduced: the outer deadline released its
  admission lease before native completion, caller abort did the same, and the
  provider accepted a cancelled late result. The lease now survives until the
  provider promise settles; native requests carry cancellation identity and
  discard late results. `dispatchCancellation.test.ts`, `dispatchDeadline.test.ts`
  and `tauriProvider.test.ts` passed **18/18** together.
- Native cancellation implementation is written, not yet runtime-verified:
  bounded request registry with startup-race tombstones and RAII cleanup;
  request-scoped ORT `RunOptions::terminate`, freshly rebound for each pooled
  session run. Opt-in `native_cancellation` executes the real bundled U2-NetP
  graph to check actual ORT termination and that an old cancel cannot poison the
  next request. The earlier queue was cancelled by a restart; the combined
  native-probe command below replaces it.
- Actual CPU arena-policy regression (`native_memory_policy`) and baseline peak
  measurement remain queued. The suspect `session.enable_cpu_mem_arena` string
  is still unchanged. No new memory figure has been established. The archived
  baseline executable is under `/tmp/opencode/ai-model-research/baseline-binary`;
  the peak probe refuses to overwrite evidence.
- Latest `pnpm verify:plan`: **58 lanes**, 78% reverse-dependent test closure,
  **no full-suite escalation**. The earlier `pnpm verify:affected` was cancelled
  by a restart; a new affected run is now in progress, not passed.
  Website E2E and the full visual suite are skipped by the planner as unrelated
  to the present scope. No full suite has run.

Native workflow inventory is still open. The generic inference host currently
creates a browser Worker even on desktop; preprocessing supports many models,
but that does not establish native execution. The existing colorization native
provider is a throwing stub and its alleged `native_infer` command is absent.
Native background removal, denoise/restoration, upscaling, and LaMa have actual
Rust routes; other advertised consumers need tracing, implementation, and real
applied-output evidence. `featureParity.ts` is stale (including SCUNet, semantic
text search, and Full's memory claim), and must not be used as completion proof.

### Acquisition and adjacent native-runtime findings (resume)

- Public HEAD probe: **36 artifact URLs returned HTTP 200**, including both
  DDColor exports. This disproves the stale 404 claim, but is not hash or
  execution evidence. Raw results: `/tmp/opencode/ai-model-research/acquisition-head.json`.
- The installed LaMa graph hashes to
  `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`, matching
  the canonical manifest. Rust's pinned digest omits the final `6`. The new
  `native_download_digests_match_the_canonical_manifest` regression is queued.
  A direct SHA-256 comparison of the actual installed artifact, canonical JSON,
  and production Rust constant reproduced rejection of the valid graph; the
  Rust digest is now corrected. The queued Rust test will be a post-fix check,
  not red evidence. The redundant job without `--features ai` was cancelled.
- Generic native acquisition returns before external-weight acquisition and
  graph repair. SAM2's upstream and repaired SHA-256 values intentionally differ;
  passing the repaired digest to the current raw native downloader cannot
  succeed. `getModelExternalData` still resolves only IndexedDB, and native
  `inference_model_path` treats file existence as integrity proof. These need
  production-boundary regressions and real acquisition verification.
- Automatic native session lookup requests the GPU cache key even when no GPU
  device exists, then stores the actual CPU session under a different key.
  `native_session_reuse` reproduced this with two real U2-NetP runs:
  `cold_loads: 2`, `warm_checkouts: 0`, `cached_entries: 2`, identical masks.
  CPU-key selection when Auto has no usable device is repaired; the first
  post-fix runtime check is pending. This affected reload/retained-memory
  measurements and must be resolved before warm-run claims.
- TrOCR is not implemented according to the advertised split model: its caller
  resolves a virtual grouping as one graph, supplies only `pixel_values`, and
  decodes against a hand-written character set. The real export needs the
  encoder, autoregressive decoder and matching tokenizer. This is an application
  defect, not a missing-model/device limit.
- Actual artifact SHA-256 audit completed from
  `/tmp/opencode/ai-model-research/verify_artifacts.py`; restartable evidence and
  downloaded source files live in `~/.cache/varve/ai-model-audit-2026-10-23/`.
  **39 files verified: 14 existing and 25 fresh downloads**, 4,859,235,854 bytes
  total, 3,029,299,510 downloaded. Manifest SHA-256:
  `c80dc501c9c981c5e600c09a824050931f0eaaf866913634adb65311c31bedfe`.
  The earlier chat count of 15 existing/24 downloads was incorrect.
  `/tmp` is a nearly full tmpfs, so large artifacts use disk-backed cache.
  This probe does not install artifacts or verify production download behavior.
- Five acquisition regressions reproduced (5 failed, 17 passed, no unhandled
  errors): setup cancellation on both download bridges, progress-listener setup
  failure cleanup, cancelled late completion, and swallowed deletion failure.
  Repairs recheck cancellation around listener setup/execution and propagate
  deletion errors. Post-fix command passed **22/22**:
  `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/engine/src/backgroundRemoval/nativeInferenceModels.test.ts
  packages/engine/src/backgroundRemoval/__tests__/tauriProvider.test.ts --maxWorkers=1`.
- Restart recovery requeued one combined native probe under the heavy lease:
  `cargo test --no-fail-fast -p varve-bgremove --features ai --test
  native_memory_policy --test native_cancellation --test native_session_reuse
  -- --ignored --nocapture`, with the shipped `ORT_DYLIB_PATH` and shared
  `CARGO_TARGET_DIR`. Canonical digest test is separately queued. Neither has
  new results yet. No corrected Lite/Full peak or Full inference exists.

### Native acquisition implementation and resumed checks

- Review restored the pre-existing 514-line worker cancellation suite byte-for-byte
  to HEAD; the new execution-ownership regressions now live in
  `dispatchExecutionOwnership.test.ts`. Those two suites plus
  `dispatchDeadline.test.ts` passed **16/16**. The earlier replacement of worker
  coverage is not retained.
- Three loader failures were reproduced: unresolved nested TrOCR encoder,
  native SCUNet readiness consulting IndexedDB, and missing native external-data
  resolution. The manifest component resolver and native sidecar bridge are
  repaired. Latest command passed **65/65** across four files:
  `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/engine/src/backgroundRemoval/nativeInferenceModels.test.ts
  packages/engine/src/backgroundRemoval/__tests__/nativeModelLoader.test.ts
  packages/engine/src/backgroundRemoval/__tests__/modelLoader.test.ts
  packages/engine/src/inference/manifest.test.ts --maxWorkers=1`.
- `model_graph_repair.rs` passed two standalone Rust tests. Production repair
  transformed the actual Small encoder from 162,703,493 to 162,703,425 bytes,
  producing the catalog's exact installed hash
  `49c179784d3ffcd1e856facc98e1060a3d4496e10e71f19c4ea677e86eec08d3`.
  A second repair produced identical bytes. Driver and evidence:
  `/tmp/opencode/ai-model-research/repair_native_sam2.rs` and
  `~/.cache/varve/ai-model-audit-2026-10-23/sam2-small-native-repaired.onnx`.
- New `model_artifacts.rs` and `inference_models.rs` use the shipped catalog as
  URL/hash authority, resolve nested graphs/tokenizers/sidecars, bound downloads,
  stage and verify all artifacts (including repair), serialize per-model
  mutations, and publish sidecars before graphs. IPC now accepts model/request
  identity only; the TypeScript bridge no longer supplies URLs or hashes.
  These Rust modules are **not compiled or real-download verified yet**.
- `inference_model_path_at` still has the original existence-only behavior while
  its corruption regression waits to run. After red evidence it must delegate
  to `model_artifacts::verified_path`; merely writing that helper has not fixed
  the live command. Background-removal's older acquisition command also remains
  separate and needs final lifecycle review.
- Pending jobs retained across this continuation (do not enqueue duplicates):
  native arena/cancellation/reuse `sh_168551d16002JWj2lFTWaLPQUt`; feature-enabled
  digest `sh_1685694c9001LGfCq7eUtnHXQO`; native readiness red
  `sh_1685959ed001o9E60IwWy3j4m3`; baseline Lite/Full peak
  `sh_1685c2a25001bzC2pegCSIY4sS`.
- New affected run: `sh_16866518a001DnyA46Vv56vMEt`, command
  `pnpm_config_verify_deps_before_run=false VARVE_LEASE_TIMEOUT=7200000
  VARVE_LEASE_POLL_MS=15000 CARGO_TARGET_DIR=/home/kevina/CodingProjects/varve/target
  VARVE_TEST_WORKERS=2 VARVE_E2E_WORKERS=1 pnpm verify:affected`.
  No whole-workflow gate, new peak measurement, Full inference/application,
  cross-platform qualification, commit, or integration is claimed.

## Catalog-to-consumer inventory

### Current continuation (supersedes queued-job status above)

- Restart cancelled the earlier affected run and native/peak probes. Current
  native batch is `sh_1686f4081001KOo1p5BpYPu4hW`; baseline peak probe is
  `sh_16871cbce001tGtvMxnCGyXitX`. Both were still waiting on the shared lease
  at this continuation. No duplicate was started. No affected run is active in
  this worktree; the surviving `verify.mjs affected` process belongs to another
  worktree. Earlier completed lanes do not constitute a passing affected gate.
- A standalone compiled probe of the actual production readiness functions
  reproduced acceptance of `b"truncated model"`. `inference_model_path_at` now
  delegates to full artifact verification. Runtime post-fix validation is pending.
- Background-removal acquisition/deletion/cancellation now use the shared native
  installer and bounded request registry. Added promotion/deletion/reuse/body-
  cancellation checks, plus verified bundled-asset materialization. These
  additions remain uncompiled. `std::fs::rename` replaces files on Windows and
  Unix per the [Rust reference](https://doc.rust-lang.org/std/fs/fn.rename.html);
  Windows sharing violations must preserve the prior file, not delete it.
- New native named float32/int64 execution, bounded binary transport (`VNT1`),
  opaque Tauri session ownership, and worker RPC adapters are written but not
  integrated or verified. The live generic worker still loads browser ORT.
  Next slice: integration and regression evidence for actual native ownership
  through cancellation, timeout, worker death and confirmed session destruction.
- Current planner: 38 changed files, 58 lanes, 78% test closure, no full-suite
  escalation. Website E2E and full visual suite remain unrelated to this slice.
- No completed new peak, Full workflow, production acquisition result, commit,
  integration, or cross-platform/GPU qualification is claimed.

### Native bridge integration and actual arena defect

- A further restart cancelled both jobs above. The interrupted baseline probe
  did start Lite: its last sample recorded `VmHWM=8169754624` bytes at 35.42 s.
  No `external.json`, final benchmark report, or `wait4` completion exists, so
  this is only an observed lower bound from an interrupted arena-enabled run,
  not a qualified peak. Partial evidence is preserved under
  `~/.cache/varve/ai-model-audit-2026-10-23/native-peak-baseline-r4/`.
- Native batch `sh_16a77f23b00118b3P3fpRUprOD` completed. Real ORT cancellation
  passed, and real U2-NetP reuse now reports one cold load, one warm checkout,
  one retained session. Canonical digest test passed; three tensor validation/
  transport tests passed. Desktop tests did **not** run: the development
  worktree lacks the `onnxruntime-libs/**/*` packaged-resource glob.
- The arena regression failed against actual ORT: it logged
  `enable_cpu_mem_arena:1` and BFCArena allocation while retaining the ignored
  `session.enable_cpu_mem_arena: 0` configuration string. The builder now uses
  `ort::ep::CPU::with_arena_allocator(false)`, which calls the real
  `DisableCpuMemArena` API. Batch `sh_16a80996f001mGVjVMd6UW1M1l`
  **passed** the actual-options assertion (`enable_cpu_mem_arena:0`), real
  cancellation and CPU reuse checks, canonical digest test, and three tensor
  validation/transport tests. This establishes the setting, not a new peak.
- The generic worker now selects native session/tensor proxies on desktop;
  shared preprocessing and all named float32/int64 outputs are retained.
  Browser ORT is not loaded on that branch. The host validates request/model
  ownership and binary result provenance. Worker retirement retains admission
  and resident leases until native runs and destruction finish; failed native
  cleanup is retained and retried before the next worker is created.
- Host routing red evidence was reproduced with the actual Tauri global shape.
  First combined post-fix command passed **21/21** across `nativeTensorWire`,
  `nativeWorkerRuntime`, `nativeWorkerHost` and existing `workerHostMessages`.
  Three further native-host regressions passed: caller cancellation/late result,
  failed destruction/retry, and result identity mismatch. These use boundary
  test doubles, not evidence of real model execution through desktop IPC.
- Native session cap allows three cached sessions plus one admitted replacement,
  so the shared registry can load then confirm eviction without falsely reaching
  capacity before its fourth model. Loading and running handles remain owned.
- Native batch `sh_16a80996f001mGVjVMd6UW1M1l` used the existing
  `scripts/cargo-with-generative-bindgen.mjs` wrapper for non-packaging desktop
  checks. The first build also regenerated the desktop lockfile's already-
  declared `tokio`/`varve-room` dependencies; no dependency was added to a manifest.
- Latest `pnpm verify:plan`: **44 files, 62 lanes, 78% closure, no full-suite
  escalation**. Affected run `sh_16a81e2e8001dwFbtbqMbIW2kQ` is in progress;
  no affected-gate pass is claimed. Full suite has not run.

### Desktop compile recovery and inspected graph contracts

- All four desktop invocations in that batch failed at the same compile error:
  `sha2` 0.11 digest output does not implement `LowerHex`. Bundled installation
  now uses the same byte-to-hex encoding as the download verifier. Added a real
  bundled U2-NetP materialization/integrity/reuse check.
- `/tmp` reached 100% capacity; new scratch and native-test `TMPDIR` use the
  disk-backed `~/.cache/varve/ai-model-audit-2026-10-23/` directory. No other
  session's files were removed. Native continuation `sh_16a86f9bb001NYqTkzI4dZZ53S`
  runs only the failed desktop lanes, tensor regressions, isolated production
  acquisition, and the corrected benchmark build under one heavy lease.
- Parsed the actual audited ONNX graphs' input/output metadata without loading
  weights. Evidence: `graph-io-inspection.json` and `inspect_graphs.py` in the
  audit cache. TrOCR's real decoder has a boolean `use_cache_branch`, int64
  `input_ids`, encoder hidden states, and 48 past-key/value inputs. The generic
  transport initially rejected bool. A raw packet regression reproduced that
  rejection; bool support now preserves explicit 0/1 values and rejects other
  bytes in both directions. Wire + worker-proxy tests passed **5/5**; updated
  native tensor tests are pending. No TrOCR recognition success is claimed.
- Read the upstream [TrOCR config](https://huggingface.co/Xenova/trocr-base-printed/raw/main/config.json)
  and [image processor config](https://huggingface.co/Xenova/trocr-base-printed/raw/main/preprocessor_config.json):
  vocab 50,265, 12 decoder layers, 16 attention heads, 64-wide keys, start/EOS 2,
  384-square resize with 0.5 mean/std. The existing 95-character sigmoid decoder
  and letterbox preprocessing do not implement that contract. Tokenizer
  acquisition and autoregressive recognition remain the next consumer slice.

### Completed native boundary batch

- `sh_16a86f9bb001NYqTkzI4dZZ53S` completed all seven commands successfully:
  corrupt-readiness **1/1**, installer/bundled-materialization **6/6**, catalog
  and integrity **3/3**, actual U2-NetP named-tensor execution/release **1/1**,
  Rust tensor validation/transport (including bool) **4/4**, real production
  acquisition **1/1**, and the corrected `bgremove_bench` executable build.
- Production acquisition verified `grounding-dino-tokenizer`, SCUNet's graph
  and external weights, repaired SAM2 Small encoder, and nested TrOCR decoder.
  The same test checked missing-sidecar readiness and cancellation during the
  real HTTP response body; it completed in 171.81 seconds. Installs are isolated
  under `~/.cache/varve/ai-model-audit-2026-10-23/native-acquisition-r1/`.
- Exact command sequence: `run_desktop_native_checks.py` in the audit cache;
  raw log: OpenCode shell `sh_16a86f9bb001NYqTkzI4dZZ53S.out`. Environment:
  disk-backed `TMPDIR`, shared `CARGO_TARGET_DIR`, shipped `ORT_DYLIB_PATH`,
  explicit `VARVE_NATIVE_ACQUISITION_AUDIT_DIR`, heavy-task lease. Desktop
  commands use `scripts/cargo-with-generative-bindgen.mjs`.
- The existing affected run `sh_16a81e2e8001dwFbtbqMbIW2kQ` remains active.
  Audits, E2E typecheck, desktop/editor/engine/codegen/compositor/home/import/
  layout typechecks have passed. No completed affected gate is claimed.
- These are real native acquisition and execution results, not yet evidence of
  every editor application workflow. Fresh corrected Lite/Full peak runs and
  real TrOCR recognition remain outstanding.

### TrOCR implementation and current continuation

This section supersedes earlier queued-job statuses, not the evidence limitations.

- Reproduced TrOCR treating its virtual group as one ONNX graph (two failing
  pipeline regressions). Recognition now runs the physical encoder, then the
  merged INT8 decoder autoregressively with the matching installed ByteLevel BPE
  vocabulary, boolean cache branch and 48 attention-cache inputs. The first run's
  cross-attention cache survives empty outputs from subsequent cached runs.
  Preprocessing stretches to 384 square with 0.5 mean/std; confidence derives
  from softmax token probability, not sigmoid of an invented character logit.
- Added the pinned tokenizer as a third TrOCR component (2,108,614 bytes,
  SHA-256 `2f1a555a1ee93656b4e6f67aa75d492a843c225e5ef754bae24c36bd85851cd7`).
  The virtual group now declares `multiComponent`. Nested graph identity and
  memory estimates resolve physical artifacts. A separate red regression showed
  composite readiness was false with all components installed; readiness now
  requires encoder, decoder and tokenizer, including the font-OCR consumer.
- Focused pipeline/preprocessor/tokenizer/catalog/manifest checks passed **58/58**.
  Loader/catalog/cross-page fixture checks then passed **60/60**. The scene gate's
  pre-existing handwritten group lacked `fill`/`effects`; its fixture now uses
  `makeGroupNode` and a typed `Document`, without weakening the compiler check.
- Additional OCR boundary checks reproduced two coordinate defects: quarter-turn
  inverse mappings were swapped; stride padding was incorrectly scaled into the
  original image dimensions. Both are corrected. Recognition crops stay in the
  corrected image's coordinate space and only result geometry is inverse-mapped.
  Detection and OCR share source-preserving padding/clipping. Padding-only regions
  disappear, and empty recognition reaches `done`. Cancellation and sequence-limit
  regressions retain errors rather than reporting successful partial text.
- Latest focused command passed **31/31**:
  `TMPDIR=~/.cache/varve/ai-model-audit-2026-10-23/tmp
  pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/engine/src/ocrPipeline/pipeline.test.ts
  packages/engine/src/ocrPipeline/orientation.test.ts
  packages/engine/src/inference/models/paddleocr.test.ts
  packages/engine/src/inference/models/trocr.test.ts --maxWorkers=1`.
  These boundary tests do not establish real OCR accuracy or rendered placement.
- Real native TrOCR test and `tensor_stdio` audit adapter are written. The adapter
  executes the production Rust `TensorSession`/VNT1 contract, never synthesized
  inference. Visually inspected the generated 432x82 fixture: **Hello world 2026**.
  Config and input live in `trocr-native-r1/` under the audit cache. This test is
  not desktop IPC or editor application evidence.
- Corrected benchmark archived at `corrected-binary-r1/bgremove_bench`, SHA-256
  `494ee724a7e793bc9051fe99fce47725188a356885013551935160fdcbeb434b`.
  Batch `sh_16a9e13630019JwXcG217BfMBZ` builds/runs real TrOCR, then fresh
  Lite/Full peak probes. `sh_16a9f64b90013A2JbnmmW7cAYy` checks production tokenizer
  acquisition/reuse. Both survived the last resume and were still lease-queued;
  no duplicates started. No result is yet claimed for either.
- Affected run `sh_16a9f2353001uc9BZm4dGDi8Hk` passed touched format/lint but
  stopped on the ByteLevel copyright byte in a test. The literal is now a Unicode
  escape with identical runtime value; `pnpm audit:emoji` passes. Current affected
  run: `sh_16aa14162001rxWlAephpdcIE1`, with disk-backed TMPDIR, shared Cargo target,
  two Vitest workers and one browser worker. It began at 58 files/68 lanes/~79%
  closure, no full escalation; later coordinate changes need current plan/check
  coverage. No green affected gate or full suite is claimed.
- Remaining OCR-specific work includes full detector-to-text execution, real
  desktop/editor application, and the separate `OcrSection` default's absent
  `paddleocr-rec-v4` artifact/dictionary path. All broader acceptance remains open.

### Worker normalization and worktree validation recovery

- Reproduced the dynamic-image worker dividing bytes by 255 twice and discarding
  model mean/std (three failing regressions). The worker now uses each model's
  `TensorSpec`, including PaddleOCR's ImageNet normalization and SCUNet /
  EfficientSAM's unit RGB. `dynamicWorkerPreprocess.test.ts` and
  `nativeWorkerRuntime.test.ts` passed **4/4** after the fix.
- The affected run `sh_16aa584cc001NbEDPai1O7hqTR` passed touched format/lint,
  audits, E2E typecheck and desktop typecheck, then failed editor typecheck on
  two new engine exports. Its dependency links resolved workspace packages from
  **master**, not this worktree. Only generated `node_modules` links were
  localized; third-party installs remain shared. After relinking,
  `pnpm_config_verify_deps_before_run=false pnpm --filter @varve/editor typecheck`
  passed. Earlier cross-package compiler passes do not qualify the repaired tree.
- Current plan: **67 files, 75 lanes, 79% closure, no full escalation**. Fresh
  affected run `sh_16aac62d8001sNvd7d3BRMeWJ1` uses the disk-backed TMPDIR, shared
  Cargo target and bounded worker counts. It is not yet a passing gate. Website
  E2E and full visual suite are skipped by the plan as unrelated.
- Native batch `sh_16aa55b680015o1r8Pn8YlE5Iw` survived this resume and remains
  queued behind the shared lease. Its driver now also runs the full OCR test
  after direct TrOCR recognition and before tokenizer acquisition/peak probes.
  `ocr-pipeline-native.test.ts` runs the real inference worker, detector, crop
  pipeline, encoder and decoder through production Rust `TensorSession`; only
  host/asset transport is adapted to Node. Inputs are pinned in
  `trocr-native-r1/pipeline-input.json`. No real recognition result, completed
  peak, Tauri IPC/application success or new integration is yet claimed.

### Default PaddleOCR acquisition, dictionary and pixels

- Inspected the actual PP-OCRv4 recognizer (10,826,336 bytes, SHA-256
  `1c7cf60de2afd728d512f4190cf37455092b45f06175365c6fc58d8cd7e2a68b`):
  `x [B,3,48,W] -> softmax_11.tmp_0 [B,T,6625]`. Its accompanying dictionary
  has 6,623 entries (26,249 bytes, SHA-256
  `28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7`).
  The upstream [recognizer](https://github.com/deepghs/imgutils/blob/main/imgutils/ocr/recognize.py)
  appends the trained space class; blank is class 0. Both actual files are in
  the isolated audit cache. Downloading these is not production-install evidence.
- Seven regressions reproduced missing catalog resources, whitespace stripping,
  cache-hit contract/cancellation bypass, malformed recognition output, network
  dictionary use during inference, and detection-only success for unsupported
  languages. Both catalogs now pin `paddleocr-rec-v4` and `paddleocr-keys-v1`;
  the pipeline reads its explicitly installed dictionary offline. Four focused
  suites (catalog, dictionary, recognition, pipeline) then passed **57/57**.
- Three `OcrSection` failures reproduced missing dictionary readiness/acquisition
  and missing unmount cancellation. Readiness now requires both graphs and the
  dictionary; source changes discard stale results and cancel prior work.
  PaddleOCR/TrOCR share deterministic white-matted bilinear OCR pixels, avoiding
  test-only canvas shims. Latest focused run passed **45/45** across
  `OcrSection.test.tsx`, `paddlerec.test.ts`, `trocr.test.ts`, `pipeline.test.ts`
  and `orientation.test.ts` with `pnpm exec vitest run ... --maxWorkers=1`.
- Affected run `sh_16aac62d8001sNvd7d3BRMeWJ1` passed audits, E2E, desktop and
  editor compilers, then failed engine typecheck on a tuple-union spread in
  `orientation.test.ts`. Explicit coordinates fix that compiler error; the new
  affected run `sh_16ab7872e001eq962VPgAes8H3` is its pending recheck and covers
  the newest OCR changes. Current plan: **75 files, 78 lanes, 79% closure, no
  full escalation**. Website E2E/full visual suite remain unrelated.
- Native batch `sh_16aa55b680015o1r8Pn8YlE5Iw` remains alive behind the shared
  heavy lease. Its driver now collects independent failures instead of letting
  one OCR failure prevent acquisition/peak probes, and adds the real PaddleOCR
  graph/dictionary acquisition/reuse check. Full-pipeline inputs for both OCR
  models are pinned in `trocr-native-r1/{pipeline,paddle}-input.json`.
  No actual OCR success, Full result, completed corrected peak, or native editor
  application is claimed yet. All current changes remain uncommitted.

### OCR application and resumed native jobs

- The restart cancelled `sh_16aa55b680015o1r8Pn8YlE5Iw`,
  `sh_16ab7872e001eq962VPgAes8H3`, and `sh_16abc74f300172n6JLh1U6qCia`.
  Replacement native batch `sh_16ac49eab001GW1epxAM9fGeM7`, affected run
  `sh_16ac894b3001h8jh74kJa01pqX`, and native desktop OCR journey
  `sh_16ac894d5001nU1mf9TfJwFdLO` survived this continuation. Both native jobs
  were still lease-queued; no result or peak was present. Do not duplicate them.
- Reproduced OCR application reporting success while creating no layer when
  source-size metadata was missing; a second regression lost the image's parent.
  `createOcrTextLayers` now uses the decoded recognition dimensions, canonical
  image placement, parent-relative affine geometry, and region-sized typography.
  It restores corrected recognition orientation and counts actual created nodes.
  The latest unit command passed **10/10** across `OcrSection.test.tsx` and
  `ocr/createOcrTextLayers.test.ts`. This is mocked-recognition and geometry
  regression evidence, not actual OCR or rendered verification. Partial crop
  sampling and tiled fills still require review against rendered outcomes.
- Added opt-in `tests/e2e/canvas/ocr-real-model.spec.ts`: actual PaddleOCR
  acquisition/ORT, editable layer creation, undo/redo, text editing and canvas
  pixel changes with the source image hidden. An optional audit-cache HTTP
  transport serves SHA-verified upstream artifacts; inference is never replaced.
  Biome and `pnpm typecheck:e2e` passed. Runtime job
  `sh_16acd7ba6001vv33hnvlm2QgNy` is queued under the heavy lease on isolated
  Vite port 17344, with `VARVE_OCR_REAL_MODEL=1` and the audited artifact cache.
- Current `pnpm verify:plan`: **80 files, 80 lanes, 79% closure, no full-suite
  escalation**. The active affected gate started before the new browser spec;
  its added typecheck was run directly and its real browser lane separately.
  Website E2E and full visual suite remain unrelated. The affected gate is not
  complete, no full suite has run, and all current repairs remain uncommitted.

### Crop/tile placement and inline readiness continuation

- Reproduced two additional OCR placement defects: a narrow visible source crop
  produced no editable layer, and a tile seam produced a horizontal scale of
  -1599. `ocr/regionPlacement.ts` now composes the canonical placement affine
  directly and checks polygon overlap. Tiled sources use the first painted
  occurrence; one editable layer is created per recognized region. Partial
  crops may leave the editable text extending beyond the source image edge.
  Focused `OcrSection.test.tsx` + `createOcrTextLayers.test.ts` passed **13/13**;
  the real browser journey now covers plain, crop and tile cases. E2E and
  editor typechecks passed for that geometry slice. This is not yet rendered
  or real-recognition evidence.
- The earlier affected run `sh_16ac894b3001h8jh74kJa01pqX` failed on a canvas-spy
  overload in `OcrSection.test.tsx`; its compiler fix passed the targeted checks.
  Its replacement `sh_16ad1d894001Ip3fLJzFUJpf3a` passed audits, all selected
  package compilers, direct tests and desktop package tests (**15 files, 90
  tests**) before a server restart cancelled it. Real-model tests were skipped
  in that ordinary run; their displayed lane success is not inference evidence.
- Began the approved **Inline readiness** route using existing Inspector
  typography, hint/status classes, shared Disclosure and Button. Added separate
  model installation/runtime facts, action-time recheck, expandable model
  details, status retry, and subscription/stale-result ownership. Settings
  background-removal rows consume the same facts. Removed the Inspector's
  Quality-to-Balanced fallback promise and GPU-required messaging; retracted
  residency numbers are no longer presented as peaks in these disclosures.
  Catalog/native admission thresholds still await the corrected peak results.
- `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/engine/src/backgroundRemoval/modelReadiness.test.ts
  packages/engine/src/backgroundRemoval/modelInfo.test.ts
  packages/engine/src/backgroundRemoval/__tests__/modelInfo.test.ts
  packages/editor/src/components/BackgroundRemoval/useBackgroundModelReadiness.test.ts
  packages/editor/src/components/Settings/BgRemovalModelsTab.test.tsx --maxWorkers=1`
  passed **34/34**. This establishes readiness and lifecycle behavior at mocked
  boundaries, not model execution. Engine typecheck passed; editor typecheck
  found the missing public `WorkerModelId` export, now added pending recheck.
  UI rendered checks and neighboring Inspector suites are still required.
- Desktop Cargo.lock changes were reviewed against the existing `tokio` and
  `varve-room` manifest declarations; no manifest dependency was added. The
  generated `onnxruntime-libs` symlink remains excluded from intended commits.
- Restart cancelled all four previous jobs before a real OCR/peak result.
  Current replacements: native execution/acquisition/peaks
  `sh_16ae561aa001km8NN51a3irvSU`, native desktop OCR
  `sh_16ae576e60018A91b8vxjFfOPE`, browser OCR
  `sh_16ae57700001krd9DQBSgWd1xJ`. No duplicates were left alive. The latest
  plan selects **90 files, 84 lanes, 79% closure, no full escalation**. A fresh
  affected run is still needed after the current compiler repair. No full suite,
  commit, integration, current native OCR success or completed corrected peak
  is claimed.

### Readiness lifecycle, native runner and explicit INT8 continuation

- Reproduced conditional-hook failure when image selection clears, background
  processing starting after cancellation or selection change during readiness,
  and late loader subscription leaks. The action readiness await now has its own
  cancellation ownership; hooks stay unconditional; stale Object Selection
  status and late Text Discovery subscriptions are suppressed. Failed native
  status is retryable rather than mislabeled as a download/browser requirement.
  Missing Auto artifacts retain native routing, and U2-Net browser execution
  remains CPU-only even when an adapter is detected. Focused readiness/Inspector/
  Settings checks passed **73/73** before the next Settings regression.
- Reproduced one failed native status probe hiding every Offline Models row.
  Per-row failure/retry now retains other rows and installed-model removal.
  `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/editor/src/components/Settings/BgRemovalModelsTab.test.tsx
  packages/editor/src/components/Inspector/sections/TextDiscoveryPanel.test.tsx
  --maxWorkers=1` passed **20/20**. These remain boundary checks, not inference.
- Real native OCR job `sh_16ae576e60018A91b8vxjFfOPE` built and launched the
  actual Tauri/WebKitGTK app, then failed before acquisition/inference because
  its Vite runner omitted `--mode wdio`. The test bridge is imported only in
  that mode. Its captured image shows the loading screen; it is not OCR evidence.
  The driver now uses the required mode, and the test waits for Home readiness
  before observing IPC. Replacement `sh_16afaed36002Zrmy5yKDMwybnN` uses an
  isolated `native-ocr-ui-r2` profile and preserves the failed r1 evidence.
- Native execution/acquisition/peak job `sh_16ae561aa001km8NN51a3irvSU` and real
  browser OCR job `sh_16ae57700001krd9DQBSgWd1xJ` survived; neither was duplicated.
  Current affected run is `sh_16af898a2001fcPk6tzjKe1Etv`: disk-backed TMPDIR,
  shared Cargo target, two unit workers, one browser worker and port 17345.
  Its starting plan selected **95 files, 87 lanes, 79% closure, no full
  escalation**. Subsequent native/INT8 changes still require current coverage.
- Two red tests demonstrated that explicit bundled INT8 requests were rejected
  by native routing. Added its exact native allowlist/catalog entry and U2-Net
  geometry/probability contract, plus result precision. The two focused suites
  now pass **20/20**. A separate genuine native INT8 graph/mask test is queued as
  `sh_16afcee1a0017JdU23wJvxqM6u`; its existing failed quantization-quality record
  remains unresolved until actual output is inspected. A 330 MB family
  reservation is conservative policy, not a newly measured INT8 peak.
- Native status now prepares verified bundled artifacts on the blocking worker
  before reporting installation. Previously an untouched native profile could
  report its shipped U2-Net graph as needing a download. Real desktop recheck
  and new native unit checks are pending.
- Readiness E2E now captures the three supported themes at two desktop widths
  and exercises clearing/restoring image selection. Those images have not yet
  been rendered or inspected. No current affected pass, completed corrected
  peak, actual OCR result, commit or integration is claimed.

### Native portrait and real OCR failure isolation

- Corrected the OCR browser locator to `Fit selection`. Its first run failed
  before inference and also found absent generated ORT/renderer WASM files and
  shared font links outside Vite's allowlist. Five generated font links are now
  worktree-local and six actual ORT Web 1.27.0 companions are staged. Copied
  renderer WASM is a genuine shared runtime fixture, not an exact-tree build:
  `varve-effects/src/{parallel.rs,lib.rs}` differ from its source tree. Hashes
  and this limitation are in `browser-prerequisites.json` in the audit cache.
- Portrait's native resolver regression failed (`null` instead of
  `modnet-portrait`). Added the exact TS/Rust route, native catalog entry,
  dynamic reference-512/stride-32 RGB preprocessing, and soft-alpha decoder.
  The artifact size is **25,888,640** bytes, verified against cached bytes.
  Native and browser paths now reject an oversized dynamic tensor and invalid
  probabilities from the pinned sigmoid export. Two browser-contract failures
  were reproduced, then four focused suites passed **52/52**. Native compilation
  and real matte test are queued in `sh_16b083428001Al9VwIlPiJc8JR`; no native
  portrait success is claimed yet. Its 400 MB reservation is unqualified policy.
- Batch `sh_16ae561aa001km8NN51a3irvSU` completed with failures. The actual
  TrOCR line result was `HELLO WORLD 2026`, failing exact case preservation.
  Full detector/recognizer results were `HELLO WORIO /U/K` (TrOCR) and
  `leuo worid 702r` (PaddleOCR), both failures. Production acquisition/reuse of
  the tokenizer and PaddleOCR graph/dictionary passed **1/1 each**.
- Inspected the original fixture and actual failed 380x16 detection crop: caps
  and baselines were visibly cut off. The DB detector's shrink map was never
  expanded. Read the upstream
  [DB postprocessor](https://github.com/PaddlePaddle/PaddleOCR/blob/main/ppocr/postprocess/db_postprocess.py):
  expansion distance is `area * unclip_ratio / perimeter`, default ratio 2.
  Varve now applies that rule to its axis-aligned boxes, excludes padding-only
  components before expansion, and clips to source pixels. The crop regression
  failed before the repair; three focused suites then passed **38/38**.
  Real rerun `sh_16b0a9cba001CGKuWEQbqDT9PV` writes `ocr-unclip-r2/` and keeps
  exact text assertions. Rotated/perspective boxes still lack deskewing.
- Corrected Lite peak attempt `native-peak-corrected-r1/` ended by SIGKILL after
  19.19 s; sampled RSS was 6,143,655,936 bytes and `wait4` maximum RSS was
  6,149,824,512 bytes. Kernel journal confirms a **global OOM kill**, PID 451334,
  at 2026-10-23 23:08:18 UTC. These are incomplete-run lower bounds, not a peak
  requirement. Full was not started because available memory (9,418,223,616
  bytes) was below the probe's provisional 10.5 GB headroom. Do not retry the
  same high-memory probe under unchanged conditions or retain the 450 MB claim.
- Surviving work: native editor OCR `sh_16afaed36002Zrmy5yKDMwybnN`, INT8
  `sh_16afcee1a0017JdU23wJvxqM6u`, browser OCR with assets
  `sh_16b017f9a001kE6wLr3IOw0aYj`, affected gate
  `sh_16af898a2001fcPk6tzjKe1Etv`. The affected gate passed selected compilers
  and is progressing through direct suites; it is not complete. The latest
  start-of-continuation plan selected 98 files/88 lanes, ~79% closure, no full
  escalation; later portrait/crop edits require refreshed coverage. Full suite,
  Windows/macOS/GPU, current readiness captures, commits and integration remain
  uncompleted.

### Colorization routing and TrOCR case diagnosis

- TrOCR's case loss is consistent with its trained task, independently of the
  detector crop. Read the [upstream author response](https://github.com/microsoft/unilm/issues/875#issuecomment-1318250656):
  the benchmark labels are case-insensitive; case-sensitive applications need a
  document-trained model. The shipped model card identifies SROIE fine-tuning.
  The original mixed-case fixture and exact-text assertions remain intact;
  this finding does not qualify case-preserving OCR or justify inferred casing.
- Traced the live photo-colorization path through `dispatchColorization` and the
  shared inference host, which now has native tensor execution. The legacy
  `colorization/providers/nativeTauriProvider.ts` had no production importers or
  barrel export, contained only throwing implementations, and referred to an
  absent `native_infer` command. Removed that dead facade and its refusal-only
  tests; real execution belongs to the existing shared host path.
- Four regressions reproduced DDColor Quality/Balanced silently selecting Tiny,
  Fast silently selecting the large model, and reporting tiling that the live
  dispatcher never performs. Explicit modes now require their corresponding
  installed artifact with a named recovery; Automatic alone may choose an
  alternative. The resolver reports the actual single-pass composition.
  `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/engine/src/colorization/runtimeResolver.test.ts
  packages/engine/src/colorization/pipeline.test.ts
  packages/engine/src/colorization/pipelineDispatch.test.ts --maxWorkers=1`
  passed **27/27** after four expected failures. Inline colorization readiness
  still needs to reflect the exact artifact required by the selected mode.
- Added actual DDColor Tiny/full native tensor and shared Lab reconstruction
  checks, using pre-sized photographic fixtures to avoid canvas test shims.
  They retain model hashes, native identity, raw reconstructed pixels, alpha
  mismatches and luminance/chroma statistics for visual inspection. Queued
  `sh_16b119633001bflIIRS8xpA3kv` uses `run_native_ddcolor.py`, a copied fresh
  executable and 6 GiB probe headroom. This is not editor/application evidence.
- Investigated the Lite OOM's misleading headroom: all 373 samples reported
  at least 3,399,102,464 bytes `MemAvailable`, so the 1.5 GB watchdog never
  triggered. The kernel recorded only 16 KiB free swap, ~7 GB Normal-zone
  zram storage and ~540 MB free Normal-zone memory at the kill. Host
  `MemAvailable` alone did not protect this run. No repeat high-memory run or
  new admission threshold is justified by these incomplete measurements.

### Restart recovery: exact colorization readiness and acquisition ownership

- All seven pending native/browser/affected jobs were cancelled by the server
  restart. Recovered logs contain no started native/browser checks; the affected
  job stopped during the editor package suite after a 30-second tooltip-test
  timeout. No surviving worktree-local runner was found. The completed evidence
  above remains retained, and no high-memory BiRefNet probe was repeated.
- Four Colorize Inspector regressions reproduced wrong-artifact readiness,
  stale state after a quality-mode change, storage failures mislabeled as missing
  models, and an older availability check overwriting a removal notification.
  Readiness and action-time model resolution now share the exact candidate
  contract. The extracted hook cancels superseded checks, guards late loader
  initialization, and retries status errors. The approved inline surface names
  the installed/missing variant, opens acquisition for that exact model, and
  separates installation from execution checks. Quality/Balanced require DDColor;
  Fast requires Tiny; Automatic alone accepts either, preferring DDColor.
- `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/editor/src/components/Inspector/sections/__tests__/ColorizeSection.test.tsx
  packages/engine/src/colorization/runtimeResolver.test.ts
  packages/engine/src/colorization/pipeline.test.ts
  packages/engine/src/colorization/pipelineDispatch.test.ts --maxWorkers=1`
  passed **49/49** after the four readiness failures. This is regression evidence,
  not actual photo-colorization execution. Native DDColor output is still pending.
- Four adjacent acquisition regressions reproduced downloads surviving dialog
  unmount, cancelled late success, a completion timer firing after unmount, and
  DDColor consent mislabeled as image upscaling. The shared download dialog now
  owns its abort/timer lifetime, ignores stale callbacks and names colorization.
  `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/editor/src/components/BackgroundRemoval/ModelDownloadDialog.test.tsx
  packages/editor/src/components/Inspector/sections/__tests__/ColorizeSection.test.tsx
  packages/editor/src/onboard/learning-system.test.tsx --maxWorkers=1`
  passed **72/72**. The existing 35-test learning suite passed unchanged in this
  isolated run; that does not establish a fix for its earlier under-load timeout.
- Unstarted native checks are consolidated in `resume_native_r3.py` under the
  heavy lease with 6 GiB headroom, job `sh_16b176430001NFd8221NqpR1Rb`. It logs
  MODNet contracts/catalog/real matte, real INT8, native exact routing, fresh
  tensor binary, expanded-crop OCR and both DDColor exports separately. No prior
  successful native checks or incomplete high-memory peak probes are repeated.
- Latest plan: **114 files, 93 lanes, 79% closure, no full escalation**. New
  affected gate `sh_16b1ed888001G53pW2vtB4eFG4` covers the changed imports and UI;
  it is not complete. Website E2E/full visual suite remain unrelated. Added
  colorization acquisition/readiness captures for three themes and two desktop
  widths; rendered validation remains pending. No new commit/integration.

### Native results recovered and Settings lifecycle repair

- Native batch `native-resume-r3/results.json` completed: MODNet contract **3/3**,
  catalog **8/8**, actual MODNet matte **1/1**, actual INT8 mask **1/1**, native
  explicit routing **1/1**, tensor example build, and actual DDColor Tiny/full
  reconstruction **2/2** passed. The batch exit code is 1 because TrOCR's exact
  case-preservation assertion still fails. Exact commands and per-command logs
  are retained with the result JSON; these checks did not apply editor results.
- Expanded-crop **PaddleOCR now passes** the unchanged `Hello world 2026`
  fixture. `ocr-unclip-r2/paddleocr-rec-v4-pipeline-result.json` records both
  detector and recognizer executing on `native-cpu`, source region
  `(10,17,412,48)` and confidence 0.99583. TrOCR now returns all correct letters
  as `HELLO WORLD 2026`, still failing the case-sensitive expected text. The
  trained casing limitation remains unresolved; no expected-text normalization.
- Visually inspected `native-ddcolor-r1/{ddcolor-tiny,ddcolor}-output.png`, the
  original corpus portrait, and `native-{modnet,int8}-r1/human-*-mask.png`.
  Both colorizers reconstruct plausible warm skin and blue/blue-gray clothing
  with source facial detail. The test inputs were deliberately stretched square;
  this does not establish original-aspect editor rendering. Both masks preserve
  the head, torso and crossed arms against the wall; the INT8 boundary is visibly
  softer. One portrait does not resolve the failed synthetic INT8 quality corpus
  or qualify fine-hair/transparent-object behavior.
- Fixed the download-dialog compiler failure by removing an unreachable abort
  after its active-download early return. `pnpm_config_verify_deps_before_run=false
  pnpm --filter @varve/desktop typecheck` passed. The preceding affected gate
  failed at this compiler after passing touched format/lint, selected audits and
  E2E typecheck; it is not a completed gate.
- The four pending Colorization Models Settings regressions failed as expected,
  with two unhandled promise rejections: no subscription cleanup, a late
  subscription after unmount, invisible removal failure, and one status error
  hiding all rows. Added owned subscriptions, superseded-check cancellation,
  per-row status errors, persistent removal errors and initialization retry.
  Additional checks cover overtaken results and recovery subscription setup.
  `pnpm_config_verify_deps_before_run=false pnpm exec vitest run
  packages/editor/src/components/Settings/__tests__/ColorizationModelsTab.test.tsx
  packages/editor/src/components/BackgroundRemoval/ModelDownloadDialog.test.tsx
  --maxWorkers=1` passed **27/27**. Settings now explains exact DDColor mode mapping
  and the implemented deterministic line-art workflow.
- Readiness job `sh_16b2060ff001K6yVoe17SytVs4` remains alive under the lease; it
  was not duplicated. Corrected native editor OCR is requeued as
  `sh_16b2442e3001paeMuxDrd7mqBS` (`native-ocr-ui-r2`, port 17343), browser OCR as
  `sh_16b2442eb0014Nfre7Fk3JFFHJ` (port 17344). Outcomes and captured pixels are
  pending. No current whole-workflow completion, commit or integration claim.
- **The affected gate and both OCR job logs are gone.** The opencode shell
  output directory was recreated at 18:53, purging `sh_16b2644fb001…` (affected),
  `sh_16b2060ff001…` (readiness) and `sh_16b2442eb…` (browser OCR). Their
  outcomes are unrecoverable, so no pass is claimed for any of them and none may
  be cited as evidence. The durable native evidence under
  `~/.cache/varve/ai-model-audit-2026-10-23/` is unaffected. Re-running the
  affected gate is required before any commit; the other two need requeueing if
  their checks are still wanted.

### WDIO runner clamped native specs to 90s

The first DDColor UI attempt timed out at 1m30s with the Preview button enabled
and no error alert. `wdio.conf.ts` pinned every non-fluidity spec to 90_000, and
Mocha's config timeout overrides the per-spec `this.timeout()`, so the colorize
spec's own 360s budget never applied. OCR passed only because it fit inside 90s.
The config now gives `colorize-native.e2e.ts` and `ocr-native.e2e.ts` a 360s
budget, matching the largest `this.timeout()` in those specs; smoke/menu specs
keep 90s and fluidity keeps its cycle-scaled budget. Verified by replicating the
spec-matching logic (colorize/OCR → 360s, smoke → 90s) and transpiling the
config cleanly. The missing root `tsconfig.json` that `tsNodeOpts.project`
references is pre-existing and unrelated.

### Colorize runner provisioned models under the wrong app identifier

The second DDColor UI attempt (`native-colorize-ui-r3`) reached a new state:
Preview enabled, no error alert, but no preview image and no native session ever
opened (`varve.log` holds startup lines only). `tauri.test.conf.json` overrides
the Tauri identifier to `dev.varve.desktop.wdio`, and the app derives its model
root from `app_data_dir()` (`filesystem.rs:99`), so the test app reads
`data/dev.varve.desktop.wdio/models/`. The runner provisioned the SHA-verified
graphs into `data/dev.varve.desktop/models/` — the release identifier — so
readiness found no installed model and the click never reached native
inference. This is a harness defect, not an engine defect: `native-ddcolor-r1`
already proves both graphs execute natively (`ddcolor-tiny` coloredFraction
0.698, `ddcolor` 0.909, both `native-cpu`, lightnessMae ~0.07, zero alpha
mismatches). The runner now derives the path from `config["identifier"]`, and
r4 is requeued. Only this runner hardcoded a path; the OCR runner downloads
through the app's own UI, and the INT8/MODNet runners use separate isolated
`models/` roots for Rust-level tests.

### Colorize readiness stall: aria-disabled Preview was clickable but inert

The identifier fix was necessary but not sufficient. `native-colorize-ui-r4`
provisioned both graphs exactly where the app reads them (`data/dev.varve.desktop.wdio/models/`,
SHA-verified against the catalog: tiny `1410b455…`, full `9c881551…`) and the
app booted cleanly, yet the journey still failed with `ddcolor-tiny returned no
preview`, no error alert, and no native session in `varve.log`. The only
evidence written was `source-canvas.png` — import and canvas worked; inference
never started.

Root cause, found by tracing the Preview button's availability contract rather
than the engine:

- `useColorizeModelReadiness` clears its snapshot to `null` at the start of
  every check, so during each quality-mode change `checking === true` and
  `modelId === null` for a short window (manifest lookup + a native status IPC
  that hashes the on-disk graph).
- `canRun` only looked at `modelId !== null`, so Preview was disabled in that
  window — but the Button receives a `disabledReason`, and with a reason the
  canonical Button renders **`aria-disabled`, not the `disabled` attribute**
  (`Button.tsx`: `isHtmlDisabled = … && !reasonActive && disabled`). It stays
  focusable, still receives clicks, and `handlePreview` no-ops on `!canRun`
  **silently**: no status, no alert.
- The WDIO spec's `preview.waitForEnabled()` checks the HTML `disabled`
  attribute, so it passed instantly, the single click landed during the check
  window, did nothing, and the 120-second preview wait expired blind.

Repairs:

1. **Product**: `ColorizeSection` now tracks `modelChecking` and passes a
   distinct reason — "Checking whether this quality mode's model is installed…"
   — so the inert control explains itself, and the readiness panel already
   showed `Checking model installation…`.
2. **Regression**: new case `keeps Preview inert while the quality mode is still
   checking installation` (both models installed → change mode → button inert
   *with* the checking reason → settles ready again). Verified red without the
   product fix (reason stayed the generic text) and green with it; the
   ColorizeSection suite is **23/23**.
3. **Test double repaired**: the test's `Button` double rendered a plain
   `disabled` prop and no `title`, and earlier assertions read only
   `.disabled` — which cannot see `aria-disabled` at all. Three readiness tests
   were passing while asserting a property that never changes. The double now
   mirrors the real contract (`aria-disabled` + `title={reasonActive ?
   disabledReason : undefined}`), availability goes through one
   `previewUnavailable()` helper that reads both, and all 23 tests pass.
4. **Spec**: `colorize-native.e2e.ts` now waits for readiness to settle before
   clicking — no reason active ⇒ `title` attribute absent — and both the
   readiness wait and the preview wait capture a screenshot plus the readiness
   status / preview panel text on timeout, so the next failure is diagnosable
   instead of blind.
5. Both user-facing provenance lines (OCR recognition, Colorize preview) gained
   `role="note"` so their `aria-label` anchors are valid per Biome's a11y rule.

Focused evidence after the repairs: `packages/engine/src/backgroundRemoval` +
Inspector/Settings suites **792/793 passed (1 skipped)**; colorization +
Colorization + BackgroundRemoval component suites **120/120**; the two section
suites **28/28**; `tsc` clean for `@varve/editor` and `@varve/engine`; Biome
clean on all five touched files.

Validation status: `pnpm verify:plan` reports **127 changed files, 98 lanes,
FULL-SUITE ESCALATION: YES** ("workspace/toolchain/validation-infrastructure
change" — `wdio.conf.ts` plus the website/architecture claim edits).
`pnpm verify:affected` therefore refuses to run and instructs
`pnpm verify:full`. The default full gate is the *remote* exact-SHA verifier,
which cannot apply to uncommitted work; the full offline gate
(`verify:full --local`, accepts a dirty tree, disables receipt reuse) is the
correct instrument here and runs after the active native journey.

### Native DDColor editor journey: staged completions r5 → r6

Each rerun advanced one stage further, with the failure point moving from
selector/handle mechanics to the actual model work:

- **r5** (`native-colorize-ui-r5`): with the settled-readiness wait, the Fast
  cycle ran a real native preview (`ddcolor-tiny-preview.png`), passed the
  provenance assertion (`native CPU (ddcolor-tiny)`), applied the result to the
  canvas with the aspect and pixel-count assertions, and captured
  `ddcolor-tiny-applied-canvas.png`. Visual inspection: grayscale source beside
  the applied colorization — blue shirt, warm skin, tinted wall, source detail
  intact. It then failed at the *redo* wait: the spec held an element handle
  taken before undo destroyed the node; a stale handle reports "not displayed"
  forever even after redo recreates the layer. The same spec pattern in OCR
  worked only because it re-resolved the locator each time. Fixed with an
  `appliedLayer()` helper that resolves fresh on every wait, plus explicit 30s
  timeouts. The r5 preview screenshot also exposed the first-run overlay
  (`Welcome to Varve`) floating over a fresh profile's editor — a close-button
  dismissal helper was added so evidence captures are clean and the backdrop
  never sits between the test and the canvas.
- **r6** (`native-colorize-ui-r6`): the **entire Fast cycle passed**, including
  undo (layer removed, pixels restored to source) and redo (layer restored,
  color back) — confirming the handle fix. The run then failed at the Quality
  preview with `ddcolor returned no preview` after the 120-second wait… but the
  new failure diagnostics proved the preview had *completed*: the captured
  `Colorize preview` panel text was
  `Preview ran on native CPU (ddcolor).ApplyDiscard` and readiness read
  `DDColor installed`. The full 915 MB graph's first native session open plus
  inference finished moments after the deadline on this shared machine; the
  product path is correct, only the wait budget was marginally too small.
- **Budget fix**: preview wait 120 s → 180 s, spec `this.timeout()` 360 s →
  480 s, and `wdio.conf.ts` `nativeModelTimeout` 360 s → 480 s (the config value
  clamps the per-spec call, so both must move). r7 requeued.

At this point both DDColor variants have executed natively inside the editor
with exact-model provenance disclosed in the panel; the remaining r7 goal is a
single green pass covering the full loop (Fast + Quality + undo/redo +
`provenances.json` + `result.json`).

- **r7 GREEN** (`native-colorize-ui-r7`, 1 passing in 3m01s; the shell's exit 1
  is the runner's process-teardown warning, the WDIO spec itself reports
  `✓ uses Tiny and full exactly and applies colored pixels without changing
  source geometry`). Full journey in the running Tauri/WebKitGTK app: both
  quality modes → native previews with panel-disclosed provenance
  (`Preview ran on native CPU (ddcolor-tiny)` and
  `Preview ran on native CPU (ddcolor)`), exact aspect preserved (320×483),
  Apply creating the `photo-result` layer with a colored-pixel increase,
  undo removing it and restoring source pixels, redo restoring both — twice,
  once per model. Evidence under `native-colorize-ui-r7/evidence/`:
  `provenances.json`, `result.json` (`canvasApply: true`, `undoRedo: true`,
  `runtime: Tauri/WebKitGTK, native CPU ORT`), preview/applied captures for
  both models. Visual inspection of `ddcolor-applied-canvas.png` (full model)
  shows plausible colorization distinct from Tiny's palette — teal-gray shirt,
  warm skin, greenish wall cast — with source detail and geometry retained.
  Acquisition in this journey is SHA-verified audit-cache provisioning;
  production *download* of DDColor remains a separate (browser/E2E) check.

### Architecture cycle regression from the native worker module

The first full-gate attempt passed Format/lint (after the format slip) and then
failed the architecture audit with a real enforced regression:

```
CYCLE REGRESSION: engine — 1 new cycle(s) not in allowlist:
        + inference/inferenceWorker.ts → inference/nativeWorkerRuntime.ts
```

Both edges were introduced by this branch's `nativeWorkerRuntime.ts`: the
worker imports the transport's runtime functions
(`acceptNativeReply`, `NativeWorkerTensor`, `openNativeWorkerSession`) while
the transport imported `WorkerTensor` back out of the worker entrypoint — the
reverse edge was type-only, but the audit counts identities, not value-ness.
Fixed structurally rather than by allowlisting: `WorkerTensor` moved to a new
leaf module `packages/engine/src/inference/workerTensor.ts`;
`inferenceWorker.ts` re-exports it (all existing importers unchanged) and
`nativeWorkerRuntime.ts` now imports the leaf, making both edges
one-directional. Verified: worker/native focused suites **22/22** and
`node scripts/audit-architecture.mjs` reports **✓ Architecture audit complete**
(previously "1 new cycle not in allowlist"). A follow-on slip — the
`export type { … } from` form re-exports for consumers but does not bind the
name locally, breaking `inferenceWorker`'s own three uses — was caught by the
gate's Typecheck lane (vitest's transform does not typecheck, which is why the
focused suites stayed green) and fixed with a local type import plus a local
type re-export; `@varve/engine` tsc and the architecture audit both re-verified
green before relaunching the gate. The audit's other `✖` counts
(unused exports, unstable modules, hub budgets) are the documented
report-only ratchets per AGENTS.md, unchanged by this work.

Gate attempt 5 then pushed through **Typecheck PASS (725s, all 20 workspace
packages plus `typecheck:e2e`)** and the whole **CI tooling test suite except
one**: `heavy-lease.test.mjs` race block failed with `new-owner exit 1`.
Root cause reproduced deterministically in isolation: the block sets
`VARVE_LEASE_TIMEOUT: '15000'` but inherited this session's exported
`VARVE_LEASE_POLL_MS=15000` (carried from the native-runner invocations into
the gate environment), making the waiting owner's wake-up interval equal its
acquisition deadline — the second poll lands exactly on the timeout and the
child exits 1. Clean env: full suite passes; polluted env: fails at line 400;
after the fix (the test file now deletes ambient `VARVE_LEASE_POLL_MS` /
`VARVE_LEASE_TIMEOUT` for its black-box children, which already set their own
timeouts explicitly): passes both ways. This is ambient-env leakage into a
hermetic lease-choreography test, not a lease-logic defect. The relaunched gate
drops both leaked variables from its environment.

Gate attempt 6 cleared that lane (`heavy-lease.test.mjs` fully green in-gate)
and pushed further before failing in the same CI-tooling lane at
`capture-safety.test.mjs` (12/15): three tests died with `EISDIR` on the
worktree-local path `apps/desktop/src-tauri/onnxruntime-libs`. Root cause is a
git rule, not a capture bug: `.gitignore` held `apps/desktop/src-tauri/onnxruntime-libs/`
with a trailing slash, which Git matches against **directories only** — and a
symlink is never a directory to Git, even one pointing at a directory. The
fetched-libs path is a real directory in the main checkout but a *symlink* to it
in this worktree (so the Rust build reuses the main checkout's downloaded
onnxruntime without re-fetching), so it escaped the ignore rule, appeared in
`git ls-files --others`, and was then `readFileSync` as if it were a regular
file — `captureSourceIdentity` hashed every untracked entry's bytes. Test 4's
expected `/already occupied/` failure was masked by the crash, and test 15
repeated it while mirroring untracked inputs into its fixture with
`copyFileSync`. Three independent repairs, all verified standalone (15/15, and
still 15/15 after formatting):

1. `captureSourceIdentity` no longer assumes every untracked entry is a regular
   file. A symlink now records `path:symlink:<target>` (the destination is a
   real identity signal — it changes what the producer would load), a directory
   records `path:directory`, and only regular files are byte-hashed. An unusual
   developer tree now records itself instead of failing the capture.
2. The test's fixture mirroring is type-aware: symlinks are re-created as
   symlinks, directories as directories, files copied. The fixture only needs
   the tree shape for the identity hash to read.
3. `.gitignore` drops the trailing slash (with a comment explaining why), so a
   worktree's symlink at that path is ignored like the fetched directory, keeping
   `git status` and the capture-source identity clean of a local convenience
   link.

Gate attempt 7 then cleared Format/lint, Emoji, Health, Architecture (669.6s),
and Typecheck (321.8s) before failing at CI tooling after **600.2s with no test
output at all**. The round duration was the clue. `verify.mjs` wraps *every*
heavy lane in the lease wrapper —

```js
argv: ['node', 'scripts/quality/heavy-lease.mjs', label, '--', ...argv],
```

— and `heavy-lease.mjs` waits `VARVE_LEASE_TIMEOUT ?? 600000` (600 s) for a
cross-worktree lease before launching anything. Attempt 5 exported
`VARVE_LEASE_TIMEOUT=7200000`, which the then-unscrubbed
`heavy-lease.test.mjs` inherited and failed on; this attempt exported *neither*
lease variable, so the wrapper fell back to the 600 s default. Another session
was running its own `verify:full --local` in a different worktree and held the
lease, so the lane waited the full 600 s and exited without executing a single
suite. Reproduced directly: invoking the wrapper against the held lease prints
`heavy-lease: waiting for <label> (pid …, started …)` on every poll.

An earlier reading of this (checking `runValidationCommand`, which is what the
*cheap* lanes use and which passes no `timeoutMs`, hence never waits on a lease)
wrongly concluded lease contention was excluded — the heavy-lane wrapper above
is what matters. Diagnostic rule for future attempts: a lane that fails at a
round-number duration with no test output is waiting, not testing. Since
`heavy-lease.test.mjs` now scrubs ambient `VARVE_LEASE_POLL_MS` /
`VARVE_LEASE_TIMEOUT` itself, a deliberately generous `VARVE_LEASE_TIMEOUT` can
be passed to the gate so heavy lanes queue behind a concurrent session instead
of failing on the default deadline.

Gate attempt 8 (with that generous timeout) never reached lane one: it died at
`startOperation` with `ENOSPC: no space left on device, write` while writing the
operation-history record. `df -h` showed `/dev/nvme0n1p2` at **100% — 15 MB
free** of 230 GB (inodes only 19% used, so block space, not inode exhaustion).
Breakdown of the 218 GB in use: `CodingProjects` 70 GB, `~/.cache` 56 GB,
`~/.local` 26 GB, `~/varve-cargo-target` 9.7 GB.

Most of my own audit cache was re-derivable bulk. Of its 20 GB, the seven
colorize rounds were 2.0 GB each, and each round held `data/` 1.3 GB
(provisioned model copies plus app data), `varve-desktop/` 730 MB (the built
binary), `cache/` 12 MB — against `evidence/` of about 1 MB. The provisioned
models are copies of canonical sources that were never at risk:
`models-source/ddcolor.onnx` (874 MB) and `ddcolor-tiny.onnx` (214 MB) in the
repository, the 2.9 GB hash-addressed `artifacts/` store, and the primary app
store `~/.local/share/dev.varve.desktop` (3.8 GB, 8 ONNX models including
`birefnet-general.onnx` and `birefnet-general-lite.onnx` for the BiRefNet
backlog). Cleanup therefore removed only `data/`, `varve-desktop/` and `cache/`
from eight superseded rounds (`native-colorize-ui-r1`…`r6`, `native-ocr-ui-r1`,
`native-acquisition-r1`) plus `tmp/`, keeping every `evidence/` tree, catalog
JSON, checkpoint (`checkpoint-r7`…`r13`), probe directory and `artifacts/`
byte-for-byte: **15 MB → 13 GB free, audit cache 20 GB → 6.6 GB**. One note on
that last entry — `native-acquisition-r1` is a model artifact store (ONNX files
at its top level), not an attempt run; its top-level models and tokenizers
survived, only its provisioned subdirectories were removed. The green rounds
(`native-colorize-ui-r7`, `native-ocr-ui-r2`) were deliberately left whole with
their binaries so the exact build behind each passing evidence set stays
inspectable.

One further point for later attempts: `full-gate.mjs` gates every
"Source changed during full gate" guard — and the receipt write — on
`initialSource.clean` (lines 187/199/207/228/231/236). Because this worktree is
deliberately dirty for the gate, `initialSource.clean` is false, so editing
working-tree documentation during a run neither aborts it nor writes a receipt.
Committing mid-run is still avoided: lane evidence must bind to one SHA.

### Gate attempt 9 — 10 of 11 non-browser lanes green

With 13 GB free and a 2-hour `VARVE_LEASE_TIMEOUT`, the gate reached the browser
lanes for the first time:

| Lane | Result |
|------|--------|
| Format and lint (19.6s), Emoji (3.8s), Health (0.1s) | PASS |
| Architecture audit (225.2s), Typecheck (90.3s) | PASS |
| **CI tooling tests (147.2s)** | **PASS** — EISDIR and lease-cadence repairs hold in-gate |
| WASM browser artifacts (81.7s) | PASS |
| JavaScript unit tests (2427.3s) | PASS |
| Rust workspace tests (524.8s) | PASS |
| Rust workspace Clippy (307.2s) | PASS |
| Chromium E2E 1/24 (1761.7s) | FAIL — 6 failed, 73 passed, 5 skipped |

### Pre-existing responsive-panel failures (proven by A/B, not caused by this work)

All six failures are in `tests/e2e/a11y/responsive-panels.spec.ts`, which this work
never touches. Reproduced standalone (6 failed / 2 passed, identical to the gate —
deterministic, not load flake), then settled with a stash-based A/B against the
branch point `2646f8850`, saving the tracked diff to `wip-backup-tracked.patch`
first:

| | baseline `2646f8850` | this work |
|---|---|---|
| `responsive-panels.spec.ts` | **8 failed / 0 passed** | 6 failed / 2 passed |

Root cause is a deliberate behavioural change that predates this branch:

- `Shell.tsx:1016` renders the responsive launchers only while
  `!distractionFreeMode && !compactDrawerOpen`, with a comment explaining they are
  "hidden while a drawer is open, because at --z-raised (10) beneath the scrim (999)
  their labels would promise an action the pointer cannot deliver."
- That gate was introduced by `077451f81` and `8e088d5f7` on **2026-10-16**, while the
  spec was last written **2026-10-02** (`d738eacb3`) — so it asserts behaviour the
  product stopped having 14 days later. Both breaking commits and the spec are
  ancestors of this branch's HEAD, and `git log 2646f8850..HEAD` is empty, so the
  baseline *is* `2646f8850`. Neither `Shell.tsx` nor the spec appears in this work's
  124-file diff, and no changed file contains `compactDrawerOpen`.

Both failure shapes follow from that single gate:

1. Tests at lines 171/226/243 assert `aria-expanded="true"` on a launcher that is
   **not in the DOM while the drawer is open** — unsatisfiable by construction. The
   failure snapshot confirms the drawer really was open (resize separator and status
   bar both present, so no tree-wide crash) while the launchers were absent, i.e.
   `compactDrawerOpen === true` exactly as committed.
2. Tests at lines 8/40/68 assert `toBeFocused()` on the launcher after the drawer
   closes. Because it unmounts on open and **remounts as a new element on close**,
   focus cannot return to it and lands on `<body>`. This is the more interesting
   finding: it reads as a genuine accessibility regression from the same 2026-10-16
   change — closing a drawer strands focus — and the spec is right to expect focus
   restoration. It is not this task's defect, and `Shell.tsx` is a hub file under
   strict import/complexity budgets, so it is reported for its owner rather than
   fixed inside an AI-model-reliability change set.

Baseline runs also hit four `Target crashed` / `Page crashed` browser deaths under
load (a second session's full gate, a live `tauri:dev`, and the desktop app were all
running), which is why the focus cases were re-run separately at baseline rather
than read off the first A/B. Both stash cycles popped cleanly and the tree returned
to exactly 124 changed paths.

**Decision (user-approved):** commit on this evidence and defer the remaining
browser shards to CI. That matches the repository's own commit-checkpoint policy,
which reports browser E2E and visual regression as "Deferred to integration/
candidate CI"; the local full gate's remaining 23 E2E shards plus demo and visual
lanes are ~12 hours of serial work, and with a dirty tree receipts are disabled, so
every attempt re-pays ~1.5 hours of upstream lanes before reaching a shard. The
pre-existing a11y finding stands on its own evidence and is not excused by the
deferral.

### Native OCR editor workflow complete

`native-ocr-ui-r2` passed the full production journey in the running Tauri app
(`native-ocr-ui-r2/evidence/`). The fixture entered through the DOM file-import
handler; a one-time acquisition ran the real detector and recognizer; the panel
disclosed `Recognition model: paddleocr-rec-v4 · ran on native CPU`. PaddleOCR
recognized the exact `Hello world 2026` (confidence 0.9958). "Create Text Layers"
inserted a real `OCR: Hello world 2026` layer over the source image, undo and
redo removed and restored it, and editing the layer's Content to
`Hello edited 2026` updated the canvas — proving the result is genuinely editable,
not a flattened bitmap. Four screenshots, a provenance record, and a result JSON
are retained as evidence. This qualifies native OCR acquisition, execution,
provenance disclosure, application, editability, and undo. TrOCR's printed
checkpoint still uppercases mixed-case text; that limitation stands.

A first attempt (`native-ocr-ui-r1`) failed only because the provenance selector
used WebDriverIO's invalid `string/=text` shorthand, which the WebKitGTK driver
rejects as a CSS selector. The provenance element now carries a declared
`aria-label="OCR recognition provenance"` anchor, and the spec selects it as a
plain attribute — no test-only CSS class.

Initial source trace, **not successful execution evidence**. The original 41 catalog entries
include five virtual groups and two tokenizer assets. TrOCR additionally declares
two component graphs only inside its group; SCUNet has an external-weight file.
The artifact probe therefore checks 39 physical files, 36 with remote URLs.
All rows still need current applied-result evidence unless a later entry explicitly
records it. `W` below means the generic browser Worker is also used on desktop;
that is not a native Rust execution route.

| Catalog entries (count) | User operation / traced owner | Current execution boundary and open requirement |
|---|---|---|
| `u2netp`, `u2netp-int8` (2) | Auto cutout / `backgroundRemoval/providers/dispatch.ts` | Native FP32 route exists. Explicit INT8 has no native allowlist/spec route. Verify both actual artifacts and results. |
| `isnet-general-use` (1) | Enhanced subject selection / `intelligence/subjectProposal.ts` | Native background removal; previous corpus masks exist, current IPC/application still pending. |
| `birefnet-general-lite`, `birefnet-general` (2) | High-quality cutout / background-removal Inspector | Native exact-model routing repaired; valid peak, Full output, current application and cancellation pending. |
| `modnet-portrait` (1) | Portrait matte / `subjectProposal.ts`, `SelectionSourcesPanel.tsx` | Dedicated browser segmentation worker; no native MODNet pipeline yet. Must preserve its dynamic aspect-ratio preprocessing. |
| `yunet-face-detect` (1) | Face-based crop/selection / `vision/backends/onnxFaceBackend.ts` | W, with multi-output face decoder. Requires genuine native inference and downstream selections. |
| `upscale-realesr-general`, `upscale-realesr-general-int8`, `upscale-realesrgan-anime` (3) | AI upscale / `upscaleProviders/nativeProvider.ts` | Existing native crate/provider; exact variant routing, artifact path, tiled output and application need qualification. |
| `scunet`, `nafnet-deblur-gopro` (2) | Denoise/deblur / `restorationProviders/` | Native restoration exists. SCUNet graph + sidecar, NAFNet BGR contract, tile blending and applied output must be checked. |
| `sam2-hiera-tiny` + encoder/decoder (3) | Click/box object selection / `context/promptedSegmentationProvider.ts` | W. Native acquisition bypasses required encoder repair; complete native encode/decode and reusable embeddings required. |
| `sam2-hiera-small` + encoder/decoder (3) | Alternate object-selection model / same provider | W. Same repair/identity problem; larger encoder needs its own execution evidence. |
| `mobile-sam` + encoder/decoder (3) | Lightweight object selection / same provider | W. Native path must keep raw HWC longest-side encoder and prompt-coordinate contracts. |
| `efficient-sam-ti` + encoder/decoder (3) | Experimental object selection / same provider | W. Native decoder must accept integer dimensions and preserve explicit unsupported mask-prompt state. |
| `depth-anything-v2-small` (1) | Depth estimation, lens blur/masks / `LensBlurSection.tsx` | W. Native tensor, depth reconstruction/storage and rendered effect need qualification. |
| `lineart` (1) | Extract line art / `LineArtSection.tsx` | W. Native extraction plus applied line-art image required. This differs from classical line-art coloring. |
| `ddcolor-tiny`, `ddcolor` (2) | Photo colorization / `colorization/pipelineDispatch.ts` | W; alleged native provider throws. Both artifacts are reachable. Native grayscale input/chroma reconstruction and applied color image required. |
| `tr-ocr-base-printed` (1; two nested component graphs) | OCR recognition / `ocrPipeline/pipeline.ts` | Incorrect single-graph/character-set implementation. Implement split encoder/decoder/tokenizer and verify actual text. |
| `font-classify` (1) | Font detection / `fontDetection/fontDetectionPipeline.ts` | W. Native class logits, label-map correctness and actual editable font application required. |
| `paddleocr-det-v4` (1) | Detect text/OCR / `DetectTextSection.tsx`, `ocrPipeline/pipeline.ts` | W for live call sites; native OCR functions also exist. Recognition graph/dictionary are outside these 41 entries and need separate acquisition tracing. |
| `detr-resnet-50` (1) | Automatic object crop / `ImageCropSection.tsx` | W. Integer attention mask and box decoding need native parity and applied crop evidence. |
| `efficientnet-lite4` (1) | Image classification / `panels/IntelligencePanel.tsx` | W. Native NHWC contract and actual user-facing classification required. |
| `lama-inpainting` (1) | Content-aware fill/expand / `contentAwareFill/`, native fill command | Native route exists; invalid Rust checksum blocks valid installation. Verify image+mask execution, blend and apply. |
| `rife-frame-interpolation` (1) | Interpolate/blend images / `BlendImagesSection.tsx` | W. Native six-channel two-frame contract and inserted output required. |
| `dinov2-small` (1) | Similar-image matching / `semanticSimilarity/embed.ts` | W. Preserve canonical resize/crop, embedding and retrieval behavior natively. |
| `siglip-base-patch16-224`, `siglip-base-patch16-224-text`, `siglip-tokenizer` (3) | Text/image semantic search / `semanticSimilarity/embed.ts`, `SemanticSearchTab.tsx` | W plus tokenizer loader. Actual native text/image embeddings and ranked matches required; tokenizer is not an ONNX graph. |
| `grounding-dino-tiny`, `grounding-dino-tokenizer` (2) | Find objects by description / `TextDiscoveryPanel.tsx` | W with experimental provider gating. Native float+integer feeds, tokenizer, decoded boxes and selected objects required. |
