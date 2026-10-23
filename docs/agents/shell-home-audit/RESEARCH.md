# RESEARCH — shell + Home

Researched 2026-10-22. Every claim that drives a decision below was fetched
this session; the URLs are the ones actually read. The briefing's seed list is
used only where marked *not independently re-verified*.

## Track A — what works (standards, platform guidance, rules)

**A1. WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum), Level AA.**
"When a user interface component receives keyboard focus, the component is not
entirely hidden due to author-created content." The Understanding document
lists the accepted remedies: make the overlay modal (and the rest `inert`),
remove the hidden content from the tab order, reflow/move content, or let the
user dismiss the overlay without advancing focus.
→ https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
→ failure technique F110 (sticky header/footer):
https://www.w3.org/WAI/WCAG22/Techniques/failures/F110.html
→ normative text: https://www.w3.org/TR/WCAG22/
Implication: a focusable control that is *not on screen at all* is the same
class of defect; the fix is tab-order removal (`inert` / `display:none`), never
`aria-hidden` alone.

**A2. Nested interactive controls are not announced (axe `nested-interactive`).**
Deque rates user impact **Serious**, WCAG 4.1.2 (A). "Focusable elements with an
interactive control ancestor … are not announced by screen readers and create
an empty tab stop." Required markup: interactive controls must have no
focusable descendants.
→ https://dequeuniversity.com/rules/axe/4.13/nested-interactive
→ practitioner confirmation that `tabindex="-1"` on the inner control does **not**
fix it — it only removes it from the tab order:
https://probeo.io/docs/en/accessibility/keyboard/nested-interactive/
Implication: the tab strip's close button cannot stay inside `role="tab"`, and
merely setting `tabIndex={-1}` (which the component already did) is not a fix.

**A3. iOS Safari zooms a focused field below 16 px.**
The zoom is `16 / field font-size`, applies to iPhone in every WebKit browser,
and does not reset on blur. The fix is a ≥16 px field, never `maximum-scale=1`
or `user-scalable=no` (those block zoom for everyone and fail WCAG 1.4.4).
→ https://defensivecss.dev/tip/input-zoom-safari/
→ https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/
→ measured threshold table: https://doesitfit.lol/blog/ios-input-zoom-16px
→ a shipped example of the same fix: https://gitlab.com/gitlab-org/gitlab/-/merge_requests/220666
Implication: Varve's search field renders 15 px → a real (if mild) zoom jump on
iPhone. Fix belongs in the `@varve/ui` search primitive, not per screen.

## Track B — what failed (redesigns and patterns that backfired)

**B1. Figma UI3 (2024–2025).** The largest recent redesign of a direct
competitor. Recurring, independently repeated criticisms: floating panels that
overlap the canvas, essential actions relocated and "hard to find", common
actions taking more clicks, reduced contrast, and controls that are *hidden* when
unavailable rather than disabled.
→ https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/
→ https://thecursormag.substack.com/p/the-fall-of-figma
→ https://forum.figma.com/share-your-feedback-26/the-ux-of-the-figma-editor-is-really-awful-45335
Implication for Varve: do not relocate or hide shell/Home affordances as part of
an "improvement"; keep frequent actions one step away; unavailable actions should
stay visible with a reason (already the repo's `disabledReason` rule).

**B2. Sonos 2024 app rebuild** — cited in the briefing's seed list as the
canonical case of a redesign that removed features and broke accessibility.
*Not independently re-verified this session*; used only as a caution, not as
evidence for any specific change.

## Track C — what users complain about (fixable in the front end)

- "Everything is tiny and hidden inside menus", "less contrast … harder to
  navigate", "I have to re-learn how to use the tools I use daily" — Figma forum
  threads above. → Keep targets ≥24 px, keep contrast pairs passing, do not
  reorganise muscle-memory surfaces.
- "Why did my design files disappear by themselves and I can't find them?"
  (Figma feedback index) → Home's job is findability; empty/error states must
  explain and offer recovery. Varve already does this (EmptyStates copy +
  storage-error alert); no change proposed.
- **Not found in the wild / not evidenced:** any complaint specifically about
  Varve's shell or Home. No public issue corpus exists for this product, so the
  complaint set is competitor-derived and is used only to set priorities.

## Track D — technical ground truth

- `axe-core` 4.11/4.13 rules used: `nested-interactive`, `heading-order`,
  `landmark-main-is-top-level`, `landmark-complementary-is-top-level`,
  `landmark-unique`, `region`, `color-contrast`. Rule behaviour verified by
  running them, not by memory.
- Measured: `elementFromPoint` + computed style on the dock splitter to test the
  "clipped/focus-obscured" candidate (see FINDINGS, rejected candidates).
- `role="presentation"` on a wrapper does **not** satisfy `aria-required-children`
  for `tablist` — tested this session; axe still reports the tablist. This is the
  fact that killed the first TabStrip fix.

## Complaints we can address (mapped)

| Complaint | Finding | Addressed |
|---|---|---|
| Screen-reader users lose structure on the start surface | F-01, F-02 | F-02 shipped; F-01 specified |
| Inner controls disappear for AT users | F-04 | specified, not shipped (no safe fix yet) |
| Mobile browser demo jumps on focus | F-03 | specified (exclusive file) |
| Editor chrome outside landmarks | F-05, F-06 | specified |
| Low-contrast/nested chrome erosion | F-05/F-06 + parity rules | guarded, not re-designed |

## Rejected ideas and why

| Idea | Why rejected |
|---|---|
| `aria-hidden` the close button to silence axe | Hides a working control from AT (rule: never fix by hiding) |
| `maximum-scale=1` for iOS zoom | Blocks zoom for everyone; fails 1.4.4 (A3) |
| Move close into a context menu / Delete only | Removes an affordance mouse users rely on (parity) |
| Convert the tablist to a list of items | Loses the APG tabs semantics and the documented focus contract |
| Wrapper with `role="presentation"` | Measured: does not fix `aria-required-children` |
| Full visual restyle of Home/shell | Out of scope; the other agent owns that direction and the identity is fixed |

## Out of frontend scope

Pricing, file-storage durability, WASM build artifacts missing in dev
(`/wasm/*.wasm` 404 → documented stub fallback), release signing, CI billing.
