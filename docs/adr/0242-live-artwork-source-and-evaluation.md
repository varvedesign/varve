# ADR-0242: Live artwork retains authored sources and shares one evaluator

- **Status:** Accepted
- **Date:** 2026-10-15
- **Scope:** Source-preserving object blends, repeats, color meshes, existing warps, and appearance effects

## Context

Varve already has source-preserving geometry modifiers, reusable pattern
definitions, and non-destructive layer effects. Their contracts are different:
warps map geometry, blends and repeats generate occurrences from sources, color
meshes define paint, and effects alter appearance. Treating these as one generic
effect list would erase important ownership and evaluation semantics.

User reports across design applications repeatedly show failures at the seams:
controls that do not change pixels, preview/export divergence, lost source
relationships after saving, effects that change unrelated colors, and controls
that cannot be edited directly on the canvas. See the linked regression ledger
in `docs/research/live-artwork-issue-regression-ledger-2026-10-15.md`.

## Decision

1. **Authored data is canonical.** A live construction stores its original
   source content, stable source and construction identities, parameters, and
   explicit overrides. Evaluated occurrences, tessellations, previews, and
   raster surfaces are derived and disposable. Disabling or releasing a
   construction must not reconstruct source content from rendered output.
2. **Keep domain contracts separate.** Geometry warps remain modifiers on
   authored geometry. Object blends and repeats are typed source-dependent
   generators. Gradient meshes are typed paint data, not warp cages or blur
   collections. Appearance filters remain in the existing effect pipeline.
3. **Use one effective evaluation contract.** Canvas rendering, thumbnails,
   hit testing, visible bounds, expansion, and export consume the same authored
   inputs and dependency context (including fonts, color settings, masks,
   patterns, and global-light context where relevant). Backend-specific paths
   may optimize this contract but must produce equivalent supported results.
4. **Keep edits transactional.** Create, parameter edit, source edit,
   disable/re-enable, release, and expand use existing semantic commands and
   history transactions. Pointer previews are provisional; cancellation,
   undo, and redo restore exact source data, parameters, identities, and valid
   selection. Derived occurrence edits are rejected or explicitly modelled as
   overrides; they never silently mutate all occurrences.
5. **Bound dependency evaluation.** Validate references and detect cycles
   before evaluation. Bound aggregate occurrences, mesh patches, subdivision,
   pixels, temporary surfaces, and queued work before allocation; make long
   evaluations cancellable. Resource refusal preserves authored content and
   exposes an actionable incomplete-preview/export diagnostic.
6. **Version meaning, not caches.** Persist schema/evaluator policy versions
   when a change can alter saved appearance. Migrations preserve existing
   appearance and unknown future payloads remain inert and recoverable with a
   diagnostic. Runtime caches include only dependencies actually consumed and
   cannot publish results for stale source revisions.
7. **State editability honestly.** Native Varve saves retain live editing.
   SVG, PDF, and raster exports report per-feature whether live semantics,
   editable vectors/text, or only rendered appearance survive. Unsupported
   features use a localized, documented fallback or fail clearly; they do not
   silently flatten the whole document or produce a false success.

## Consequences

- New scene types and commands must connect to persistence, history,
  duplication/remapping, renderer evaluation, selection/bounds, and export
  capability reporting before they are considered complete.
- Existing warp, pattern, and layer-effect implementations are extended at
  their owning boundaries; this ADR does not authorize a second document tree,
  renderer, or generic node-editor platform.
- Exact feature limits, geometric correspondence, color interpolation,
  fallback choices, and output tolerances are specified and tested with each
  vertical slice, then reflected in the relevant architecture and user docs.
- Marketing claims follow the implemented capability matrix and visual/export
  evidence. A UI control or serialized parameter alone is not proof that a
  capability works.

## Validation

Each vertical slice adds a regression for create → edit source and parameters →
undo/redo → save/reopen → duplicate or transfer → export/expand. Tests compare
source data and dependency references as well as output pixels and portable
file structure. Issue-derived cases are recorded in the regression ledger.
