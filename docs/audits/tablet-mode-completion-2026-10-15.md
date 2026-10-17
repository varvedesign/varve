# Tablet-mode completion audit — 2026-10-15

**Status:** complete for this pass; physical-device items remain unverified handoffs
**Repository snapshot:** session work on `master` from `e5a52de71`
**Method:** fresh platform/competitor research (FigCraft issue tracker ledger, W3C
Pointer Events 3, WCAG 2.2 target-size/dragging understanding docs, Chrome
VirtualKeyboard + viewport-resize behavior docs), a code-level architecture
inventory, live Chromium probes at Duet-like CSS viewports (1200x750,
750x1200, 960x600, DPR 1.25, touch-capable), and the existing emulated-device
E2E suite. Research ledgers were delivered in-session; this document records
the decisions and evidence that outlived them.

## 1. Audit matrix (workflow → state → issue → fix)

| Workflow / surface | Implementation state | Issue found this pass | Severity | Smallest coherent fix | Fixed |
|---|---|---|---|---|---|
| System Back dismisses overlays | `TabletBackDismiss` registry + guard | Legacy raw-`<dialog>` fallback synthesized an Escape *keydown*: cannot fire a native dialog's default close (Back died on dialogs without app-level Escape listeners) and bubbled into document shortcut handlers — the exact wrong-control failure the contract forbids; contradicted `responsive-workspace.md` | High (data-safety: gesture appears dead or leaks) | Fire the dialog's cancelable `cancel` event; close only when unclaimed | Yes (`e2c0351cb`) |
| Path anchor / handle editing (touch) | `findNodeEditHit` pure hit test | Anchor 8px / handle 7px / segment 9px radii — far below the WCAG 2.5.8 24px floor, no hover affordance on touch | High (a11y floor) | Touch-aware tolerance set (24/24/12) selected per `pointerType`; unknown/empty pointer types treated touch-like to match `inputPolicy` ownership | Yes (`56709dfed`, `a4c582270`) |
| Page tool resize corners (touch) | `PageTool` corner tolerance | 10px screen-space tolerance | High (a11y floor) | 24px for touch, 10px otherwise | Yes (`56709dfed`) |
| Auto layout presentation | `resolveLayoutPresentation` | `responsive-workspace.md` described a rule (1280px band; observed touch upgrades wide layouts) the code deliberately does not implement — fine-pointer devices must keep desktop/compact | Medium (doc trust) | Doc rewritten to state the real rule; the conservative code behavior is intentional (anti-hijack for touchscreen laptops / pen displays) | Yes |
| Two-finger twist view rotation | Missing (documented gap); camera rotation machinery + toolbar/menu commands existed | Touch had no rotation path at all | Medium (feature gap) | Dead-zone accumulator (`twistRotation.ts`) + `rotateAboutScreenPoint` composition in the touch pinch and WebKit gesture streams; Drawing-input toggle; replacement contact pair resets the accumulator | Yes (this pass) |
| Tablet layer-order controls | `TabletTouchControls` popover | Only forward/backward; `ArrangeOp` already had `front`/`back` | Low (parity) | Bring to front / Send to back buttons | Yes (this pass) |
| Double-tap into a text node | `SelectTool.onDoubleClick` handles text/callout/table | No touch E2E coverage for the synthesized double-tap path; the behavior-matrix row claimed the path existed untested | Low (evidence gap) | New tablet-text-editing test drives the real double-tap | Yes (this pass) |
| Tap accidental movement (Figma iPad complaint) | 3 CSS px screen-space threshold | None found (tap-does-not-move E2E exists and passes) | — | — | Verified in place |
| Popover size stability under hover (FigCraft #550 class) | `TabletTouchControls` popover | None found (probe: size stable across hover cycles) | — | — | Verified in place |
| Inspector scrollbars in dark themes (FigCraft #557 class) | Tokenized `scrollbar-color`/width | None found | — | — | Verified in place |
| Image paste / drag-drop (FigCraft #492 class) | Window-level paste + drop with file items | None found (unit-covered extraction) | — | — | Verified in place |
| UI scale on high-DPI (FigCraft #540 class) | `fontSizeUI` + `uiDensity` preferences, both consumed | None found (earlier inventory claim of a dead setting was wrong — `applyInterfaceAppearance` consumes it) | — | — | Verified in place |

Not attempted, with reasons: pen barrel-button action customization (needs a
per-tool semantics audit before any mapping is honest — remains a documented
gap), command-palette touch-first entry point (StatusBar chip already reaches
it; a second entry adds clutter without a reported failure), Safari gesture
`rotation` property (wired in the gesturechange stream, but only synthesically
testable on Chromium — labeled unverified below).

## 2. Evidence

| Check | Environment | Result |
|---|---|---|
| `twistRotation.test.ts` (dead zone, wrap, residue, reset) | vitest, jsdom | 9/9 passed |
| `TabletTouchControls.test.tsx` (front/back set, guide copy) | vitest, jsdom | 3/3 passed |
| `TabletBackDismiss.test.tsx` (cancel contract, guard re-push) | vitest, jsdom | 6/6 passed |
| `nodeEditGeometry` + `NodeEditTool` + `PageTool` tolerance tests | vitest | 43/43 passed |
| ChromeOS device matrix incl. new two-finger twist test | Chromium, workers=1, CDP touch, heavy-lease wrapped | see §3 run log; twist test asserts 5° < rotation < 60° on the status chip, document bytes unchanged, page scale 1 |
| Tablet text editing incl. new double-tap test | Chromium, hasTouch | see §3 run log |
| Live probes (layout mode, overflow, 24px targets, FAB clearance) | Chromium, Duet-like viewports | clean at 1200x750 / 750x1200 / 960x600 / DPR 1.25 |

Screenshots inspected: portrait nonmodal Inspector sheet, 320x640 reflow
floor, landscape tablet chrome (test-results under `tablet-validation*` run
output dirs). A successful screenshot command was not treated as validation:
geometry, serialized document state, and chip text were asserted alongside.

## 3. Run log

| Run | Scope | Result |
|---|---|---|
| Matrix (lease-held) | 40 tests incl. the twist test | 35 pass in-run; twist ✓, pen/pinch/back-gesture ✓; 5 failures (boundary drift, portrait sheet, drawers, rotation boot) all passed on isolated rerun — mid-run Vite reloads from concurrent sessions editing the watched tree |
| Attribution rerun | the 5 failed + rotation | 4/6 pass clean; rotation-mid-gesture failed at *boot* (shared.ts waits < the documented ~76s cold-paint ceiling) — budget raised to 180s; double-tap failed on input timing |
| Tablet family | keyboardless, editing-controls, poster, hybrid, low-end, text-editing | 7/8 in-run; every failure a load artifact at machine load ~24 (unrelated poster flow timed out on the same canvas-ready wait); double-tap verified separately |
| Double-tap verification | instrumented standalone run at the exact test viewport | dblclick synthesis confirmed for touch and mouse; feature opens the editor; the in-suite failures were the OS double-click window closing between protocol round-trips under load |
| Final confirmation | poster + text-editing pair (the ordering that failed) | **4/4 passed in 4.1m** — rotation ✓ (180s budget), double-tap ✓ |

## 4. Device-only handoff (unchanged, unclaimed)

USI Pen 2 pressure/tilt/twist/eraser/barrel/palm truth; real on-screen
keyboard geometry in tab vs installed PWA; ChromeOS physical edge-swipe
dispatch; two-finger twist feel on real glass (dead zone tuned to 5° from
emulation only); Safari `gesturechange` rotation on iPadOS. The Twist
setting default (on) follows Concepts/Procreate conventions, but the dead
zone value is an emulation-only measurement until a device run.
