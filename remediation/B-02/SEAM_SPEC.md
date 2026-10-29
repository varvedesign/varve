# B-02 seam specification — print/PDF pipeline crate-root split

Phase 02 artifact, written before any source edit. Companion files:
`remediation/B-02/RESEARCH.md` (research/guardrails) and
`remediation/B-02/GAP_ANALYSIS.md` (gaps/decisions). This file is the
declaration inventory, destination map, and proof plan required by
`remediation/prompts/02-SEAM-EXECUTION-TEMPLATE.md`.

## Resolved values

| Key | Value |
|---|---|
| Batch | B |
| Entry id | B-02 |
| Package | `crates/varve-print` |
| Target file | `crates/varve-print/src/lib.rs`, 6,823 lines, frozen at 6823 |
| Covering test | inline `#[cfg(test)] mod tests`: lines 3893-6823 (2,931 lines), 93 `#[test]` fns; `cargo test -p varve-print` |
| Seam | one destination-directory split of the print/PDF pipeline crate root: options, colour/blend, path + shape geometry, perspective geometry, image/colour resources, gradient shading, fills (dispatcher + two extracted arms), paint (strokes/effects/graphics state), text, fonts, rich text, and `export_pdf`; `lib.rs` keeps a thin public entry and re-exports |
| Destination | `crates/varve-print/src/pdf/` (destination directory = one seam; precedent `packages/editor/src/menu/defs/`) |
| Worktree | `.worktrees/B-02` |
| Branch | `seam/B/B-02-print-pipeline` |
| Base commit | `b6d8572e3a8b509a610feb9878f38f9cfb976b1b` (local `master`) |
| Expected parent | `lib.rs` <= 120 lines (thin entry: docs, inner attributes, existing `pub mod`s, `pub use outline`, `pub use blend`, `mod pdf;`, re-exports, `pub fn export_pdf` delegating) |
| Expected ratchet | 954 -> 953 frozen entries; exactly one removed; 0 added, 0 grown |
| Expected tests | `cargo test -p varve-print`: 198 collected / 198 passed / 0 failed before and after |

## Pre-flight log (worktree, before any edit)

```
$ git worktree add .worktrees/B-02 -b seam/B/B-02-print-pipeline master
Preparing worktree (new branch 'seam/B/B-02-print-pipeline')
HEAD is now at b6d8572e3 refactor(desktop): split Tauri command surface ...

$ git status --short --branch
## seam/B/B-02-print-pipeline          # clean

$ pnpm install --frozen-lockfile
ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK: Failed to open the store operation
lock at "pnpm-store-operation-locks": Read-only file system (os error 30)
# Environment limit; substituted by 22 node_modules symlinks to the main
# checkout plus an ignored copy of apps/desktop/src-tauri/onnxruntime-libs.

$ node scripts/quality/audit-file-size.mjs --report
Scanned 6124 source files; 954 over the 400-line cap; 954 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 316710 lines. Baseline entries: 954 (0 stale).

$ pnpm audit:filesize
File-size budget OK: 6124 source files scanned; 954 over 400 lines, all frozen

$ pnpm check:agent
EROFS: read-only file system, open
'/run/user/1000/varve-validation-queue/exclusive.lock'          # exit 1
# Environment limit; substitute = the same recursive tsc program that
# check:agent:raw runs (packages/*/tsconfig.json, apps/desktop, tests/e2e);
# see "Execution results".

$ node scripts/quality/godsplit-plan.mjs crates/varve-print/src/lib.rs
godsplit-plan: unsupported file extension: .rs                     # exit 2

$ node scripts/quality/refactor-verify.mjs --base master \
    --target crates/varve-print/src/lib.rs --json
refactor-verify: cannot parse crates/varve-print/src/lib.rs:
'#!' can only be used at the start of a file.                     # exit 2
$ node scripts/quality/refactor-verify.mjs --base master \
    --target crates/varve-print/src/lib.rs --dest crates/varve-print/src/pdf --json
refactor-verify: cannot read --dest ...: ENOENT                    # exit 2
```

The TS seam tools cannot parse Rust (measured above; same A-07 substitution
recorded on the checkpoint). The declaration-preservation gate for this seam is
the inventory/partition/byte-identity matrix in this file plus
`cargo test -p varve-print`, not `refactor-verify`.

`cargo test -p varve-print` on the untouched worktree:
```
running 198 tests
test result: ok. 198 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

## Inventory method (A-07 Rust substitution)

`godsplit-plan` cannot parse the target, so the inventory is built with a
raw-string-aware Rust line scanner (tracks `"..."`, `r#"..."#`, char
literals/lifetimes, line and nested block comments, and brace depth), reviewed
by hand against the source. It reports every top-level item in the non-test
region and every depth-1 item inside `mod tests`, with 1-based start/end
lines. The matrix then classifies every base line 1-6823 exactly once:
kept-in-`lib.rs`, moved-to-one-module, or planned-edit line. The scanner's
declaration names and ranges are the ones in the tables below; departures from
those ranges are only the `render_fills` arm extraction recorded in
"Planned non-mechanical edits".

Totals: 100 top-level items (19 header items + 81 declarations), non-test
region 3,802 lines including the 56-line header; test module 2,931 lines
containing 93 tests, 14 helpers, and 3 `use` items. Largest declarations:
`render_fills` 726 lines (sub-split), `export_pdf` 362 lines (fits one
module), `render_effects` 174, `render_perspective_triangles` 143,
`shape_path_operators` 131. The only declaration over 400 lines is
`render_fills`.

## Header-item disposition (lines 17-54)

| Source lines | Declaration | Disposition |
|---|---|---|
| 17-17 | `pub mod blend;` | stays in lib.rs |
| 18-18 | `pub mod cmyk;` | stays in lib.rs |
| 19-19 | `pub mod icc;` | stays in lib.rs |
| 20-20 | `pub mod marks;` | stays in lib.rs |
| 21-21 | `pub mod outline;` | stays in lib.rs |
| 22-22 | `pub mod profiles;` | stays in lib.rs |
| 23-23 | `pub mod resources;` | stays in lib.rs |
| 24-24 | `pub mod shaper;` | stays in lib.rs |
| 25-25 | `pub mod subset;` | stays in lib.rs |
| 27-27 | `pub use blend::{blend_mode_label, needs_blend_graphics_state, pdf_blend_name, UnrepresentedBlend};` | moves to pdf/prelude.rs |
| 29-32 | `pub mod test_fonts;` | stays in lib.rs |
| 34-34 | `use varve_colour::engine_color_rgba;` | moves to pdf/prelude.rs |
| 36-38 | `pub use outline::{` | moves to pdf/prelude.rs |
| 40-40 | `use std::collections::HashMap;` | moves to pdf/prelude.rs |
| 42-42 | `use ab_glyph::Font as AbGlyphFont;` | moves to pdf/prelude.rs |
| 43-43 | `use lopdf::{dictionary, Document, Object, ObjectId, Stream};` | moves to pdf/prelude.rs |
| 44-47 | `use varve_core::{` | moves to pdf/prelude.rs |
| 49-52 | `use crate::subset::{` | moves to pdf/prelude.rs |
| 54-54 | `use crate::profiles::PrintProfile;` | moves to pdf/prelude.rs |

## Declaration inventory (81 moved declarations, source order)

| Source lines | Lines | Kind | Visibility | Declaration | Destination |
|---|---:|---|---|---|---|
| 56-87 | 32 | struct | pub | `PdfOptions` | pdf/options.rs |
| 89-108 | 20 | impl | private | `impl PdfOptions` | pdf/options.rs |
| 110-119 | 10 | fn | private | `color_to_rgb_string` | pdf/colour.rs |
| 121-151 | 31 | fn | private | `cmyk_normalized` | pdf/colour.rs |
| 153-155 | 3 | fn | private | `is_spot_color` | pdf/colour.rs |
| 157-173 | 17 | fn | private | `spot_color_separation` | pdf/colour.rs |
| 175-204 | 30 | fn | private | `color_to_cmyk_string` | pdf/colour.rs |
| 206-212 | 7 | fn | private | `color_to_stroke_rgb_string` | pdf/colour.rs |
| 214-237 | 24 | fn | private | `color_to_stroke_cmyk_string` | pdf/colour.rs |
| 239-369 | 131 | fn | private | `shape_path_operators` | pdf/paths.rs |
| 371-417 | 47 | fn | private | `append_path_ring` | pdf/paths.rs |
| 419-430 | 12 | fn | private | `path_uses_even_odd_fill` | pdf/paths.rs |
| 432-438 | 7 | fn | private | `path_fill_operator` | pdf/paths.rs |
| 440-446 | 7 | fn | private | `path_clip_operator` | pdf/paths.rs |
| 448-465 | 18 | struct | pub(crate) | `ImageRenderState` | pdf/resources.rs |
| 467-551 | 85 | impl | private | `impl ImageRenderState` | pdf/resources.rs |
| 553-586 | 34 | fn | pub(crate) | `add_image_render_resources` | pdf/resources.rs |
| 588-604 | 17 | fn | private | `generate_checkerboard` | pdf/resources.rs |
| 606-678 | 73 | fn | private | `compute_pdf_image_placement` | pdf/resources.rs |
| 680-747 | 68 | fn | private | `shape_local_bounds` | pdf/paths.rs |
| 749-758 | 10 | fn | private | `multiply_pdf_affine` | pdf/paths.rs |
| 760-765 | 6 | fn | private | `apply_pdf_affine` | pdf/paths.rs |
| 767-769 | 3 | fn | private | `node_affine` | pdf/paths.rs |
| 771-800 | 30 | fn | private | `gradient_page_affine` | pdf/shading.rs |
| 802-828 | 27 | fn | private | `image_content_affine` | pdf/geometry.rs |
| 830-850 | 21 | fn | private | `transformed_rect_clip` | pdf/geometry.rs |
| 852-872 | 21 | fn | private | `pdf_image_matrix` | pdf/geometry.rs |
| 874-874 | 1 | const | private | `PERSPECTIVE_GRID` | pdf/geometry.rs |
| 876-896 | 21 | fn | private | `perspective_quad_valid` | pdf/geometry.rs |
| 898-911 | 14 | fn | private | `bilinear_quad_point` | pdf/geometry.rs |
| 913-942 | 30 | fn | private | `solve_linear3` | pdf/geometry.rs |
| 944-961 | 18 | fn | private | `triangle_affine` | pdf/geometry.rs |
| 963-980 | 18 | fn | private | `inverse_affine` | pdf/geometry.rs |
| 982-1124 | 143 | fn | private | `render_perspective_triangles` | pdf/geometry.rs |
| 1126-1139 | 14 | fn | private | `shape_pdf_bounds` | pdf/paths.rs |
| 1141-1150 | 10 | enum | private | `ShadingKind` | pdf/shading.rs |
| 1152-1159 | 8 | struct | private | `GradientShadingDef` | pdf/shading.rs |
| 1161-1167 | 7 | struct | private | `ShadingRegistry` | pdf/shading.rs |
| 1169-1284 | 116 | impl | private | `impl ShadingRegistry` | pdf/shading.rs |
| 1286-1354 | 69 | fn | private | `create_sampled_function` | pdf/shading.rs |
| 1356-1416 | 61 | fn | private | `sample_gradient` | pdf/shading.rs |
| 1417-2142 | 726 | fn | private | `render_fills` | pdf/fills.rs |
| 2144-2224 | 81 | fn | private | `render_strokes` | pdf/paint.rs |
| 2226-2399 | 174 | fn | private | `render_effects` | pdf/paint.rs |
| 2401-2435 | 35 | fn | pub | `embed_image` | pdf/resources.rs |
| 2437-2496 | 60 | fn | pub | `embed_image_with_colorspace` | pdf/resources.rs |
| 2498-2502 | 5 | fn | pub | `rgba_extract_alpha` | pdf/resources.rs |
| 2504-2509 | 6 | fn | pub | `rgba_to_rgb` | pdf/resources.rs |
| 2511-2551 | 41 | fn | private | `shape_to_pdf_content` | pdf/paint.rs |
| 2553-2574 | 22 | fn | private | `check_lossy_color` | pdf/colour.rs |
| 2575-2649 | 75 | fn | private | `fill_to_color_string` | pdf/colour.rs |
| 2653-2660 | 8 | fn | private | `fill_visible` | pdf/colour.rs |
| 2662-2669 | 8 | fn | private | `fill_opacity` | pdf/colour.rs |
| 2671-2678 | 8 | fn | private | `fill_blend_mode` | pdf/colour.rs |
| 2680-2698 | 19 | fn | pub | `blend_is_representable` | pdf/colour.rs |
| 2700-2751 | 52 | fn | pub | `unrepresented_blend_modes` | pdf/colour.rs |
| 2753-2773 | 21 | fn | pub(crate) | `assert_pdf_blends_are_representable` | pdf/colour.rs |
| 2775-2783 | 9 | fn | private | `effective_fill_alpha` | pdf/paint.rs |
| 2785-2808 | 24 | fn | private | `write_fill_graphics_state` | pdf/paint.rs |
| 2810-2831 | 22 | fn | private | `write_node_graphics_state` | pdf/paint.rs |
| 2833-2876 | 44 | fn | private | `glyph_outline_to_pdf` | pdf/text.rs |
| 2878-2888 | 11 | struct | private | `EmbeddedFontEntry` | pdf/fonts.rs |
| 2890-2908 | 19 | fn | private | `build_tj_array` | pdf/text.rs |
| 2910-2928 | 19 | fn | private | `escape_pdf_string` | pdf/text.rs |
| 2930-2935 | 6 | fn | pub | `requires_outline` | pdf/text.rs |
| 2937-2941 | 5 | fn | pub | `has_non_winansi` | pdf/text.rs |
| 2943-2949 | 7 | fn | private | `shape_text` | pdf/text.rs |
| 2951-2962 | 12 | fn | private | `can_encode_win_ansi` | pdf/text.rs |
| 2964-2982 | 19 | fn | private | `encode_win_ansi` | pdf/text.rs |
| 2984-2998 | 15 | fn | private | `collect_text_per_family` | pdf/text.rs |
| 3000-3007 | 8 | fn | private | `font_ascender` | pdf/fonts.rs |
| 3009-3068 | 60 | fn | private | `read_font_metrics` | pdf/fonts.rs |
| 3070-3080 | 11 | struct | private | `FontMetrics` | pdf/fonts.rs |
| 3082-3161 | 80 | fn | private | `embed_font_program` | pdf/fonts.rs |
| 3163-3226 | 64 | fn | private | `build_to_unicode_cmap` | pdf/fonts.rs |
| 3228-3236 | 9 | struct | private | `RichTextRun` | pdf/rich_text.rs |
| 3238-3292 | 55 | fn | private | `parse_rich_text_runs` | pdf/rich_text.rs |
| 3294-3439 | 146 | fn | private | `render_rich_text_to_pdf` | pdf/rich_text.rs |
| 3441-3802 | 362 | fn | pub | `export_pdf` | pdf/export.rs |
| 3804-3872 | 69 | fn | private | `try_outline_node` | pdf/text.rs |
| 3874-3891 | 18 | fn | private | `get_ascender` | pdf/text.rs |
## Test inventory (93 tests, source order)

| Source lines | Lines | Test | Destination |
|---|---:|---|---|
| 4046-4053 | 8 | `path_ops_rect` | tests/paths.rs |
| 4055-4085 | 31 | `path_ops_circle` | tests/paths.rs |
| 4087-4143 | 57 | `path_ops_path_no_fill_stroke` | tests/paths.rs |
| 4145-4197 | 53 | `path_ops_compound_path_emits_hole_subpath` | tests/paths.rs |
| 4199-4235 | 37 | `path_ops_empty_path` | tests/paths.rs |
| 4239-4248 | 10 | `render_fills_solid` | tests/fills.rs |
| 4250-4258 | 9 | `render_fills_gradient` | tests/fills.rs |
| 4260-4290 | 31 | `render_fills_spot_color_separation` | tests/fills.rs |
| 4292-4318 | 27 | `render_fills_gradient_emits_shading` | tests/fills.rs |
| 4320-4377 | 58 | `render_fills_gradient_preserves_explicit_affine_in_page_space` | tests/fills.rs |
| 4379-4388 | 10 | `render_fills_fallback` | tests/fills.rs |
| 4390-4404 | 15 | `render_fills_multi` | tests/fills.rs |
| 4406-4444 | 39 | `render_fills_opacity` | tests/fills.rs |
| 4446-4453 | 8 | `render_fills_invisible` | tests/fills.rs |
| 4455-4487 | 33 | `render_fills_image_not_rendered_as_solid_black` | tests/fills.rs |
| 4489-4522 | 34 | `render_fills_pattern_omits_missing_source_instead_of_rendering_gray` | tests/fills_pattern.rs |
| 4524-4554 | 31 | `render_fills_pattern_honours_dimension_overrides_fallback` | tests/fills_pattern.rs |
| 4556-4644 | 89 | `render_fills_pattern_embeds_raster_tile` | tests/fills_pattern.rs |
| 4646-4677 | 32 | `render_fills_pattern_without_manifest_omits_instead_of_faking_artwork` | tests/fills_pattern.rs |
| 4679-4741 | 63 | `render_fills_pattern_missing_tile_in_manifest_omits_instead_of_faking_artwork` | tests/fills_pattern.rs |
| 4743-4836 | 94 | `render_fills_pattern_with_rotation_and_document_alignment_reports_unsupported_layout` | tests/fills_pattern.rs |
| 4838-4845 | 8 | `render_fills_empty_fills_fallsback` | tests/fills.rs |
| 4847-4853 | 7 | `render_fills_none_fallsback` | tests/fills.rs |
| 4857-4879 | 23 | `pdf_image_placement_matches_canvas_fit_policies` | tests/paths.rs |
| 4919-4981 | 63 | `export_pdf_embeds_pattern_tile_alpha_and_fill_opacity` | tests/fills_image.rs |
| 4983-5044 | 62 | `render_fills_image_perspective_subdivides_into_pdf_triangles` | tests/fills_image.rs |
| 5046-5073 | 28 | `render_fills_image_with_document_renders_xobject` | tests/fills_image.rs |
| 5102-5126 | 25 | `render_fills_image_without_manifest_embeds_checkerboard_placeholder` | tests/fills_image.rs |
| 5128-5155 | 28 | `render_fills_image_with_manifest_embeds_source_dimensions` | tests/fills_image.rs |
| 5157-5224 | 68 | `render_fills_image_crop_transform_uses_full_source_geometry` | tests/fills_image_b.rs |
| 5226-5279 | 54 | `render_fills_image_uses_complete_object_affine` | tests/fills_image_b.rs |
| 5281-5295 | 15 | `render_fills_image_without_document_compat` | tests/fills_image_b.rs |
| 5297-5363 | 67 | `render_fills_image_nonrect_clips` | tests/fills_image_b.rs |
| 5365-5407 | 43 | `render_fills_image_with_opacity` | tests/fills_image_b.rs |
| 5409-5418 | 10 | `export_pdf_with_image_fill` | tests/fills_image_b.rs |
| 5420-5473 | 54 | `render_fills_image_multiple_fills_mixed` | tests/fills_image_b.rs |
| 5475-5496 | 22 | `render_fills_image_uses_cmyk_comment` | tests/fills_image_b.rs |
| 5528-5540 | 13 | `render_strokes_width` | tests/paint.rs |
| 5542-5572 | 31 | `render_strokes_preserves_stroke_color_alpha` | tests/paint.rs |
| 5574-5585 | 12 | `render_strokes_cap` | tests/paint.rs |
| 5587-5598 | 12 | `render_strokes_join` | tests/paint.rs |
| 5600-5613 | 14 | `render_strokes_dash` | tests/paint.rs |
| 5615-5627 | 13 | `render_strokes_invisible` | tests/paint.rs |
| 5629-5634 | 6 | `render_strokes_empty` | tests/paint.rs |
| 5638-5664 | 27 | `render_effects_dropshadow` | tests/paint.rs |
| 5666-5722 | 57 | `drop_shadow_pdf_uses_its_blend_mode_and_combined_alpha` | tests/paint.rs |
| 5724-5763 | 40 | `normal_drop_shadow_overrides_its_nodes_non_normal_blend_mode` | tests/paint.rs |
| 5765-5770 | 6 | `render_effects_no_effects` | tests/paint.rs |
| 5772-5785 | 14 | `render_effects_adjustment_filters_commented` | tests/paint.rs |
| 5787-5796 | 10 | `render_effects_empty_filters_produce_no_output` | tests/paint.rs |
| 5798-5822 | 25 | `render_effects_inner_shadow_commented` | tests/paint.rs |
| 5824-5846 | 23 | `render_effects_depth_blur_commented` | tests/paint.rs |
| 5850-5864 | 15 | `embed_image_creates_xobject` | tests/export.rs |
| 5866-5871 | 6 | `embed_image_short_data` | tests/export.rs |
| 5873-5902 | 30 | `embed_image_document_has_stream` | tests/export.rs |
| 5906-5909 | 4 | `smoke` | tests/export.rs |
| 5911-5924 | 14 | `export_pdf_returns_valid_bytes` | tests/export.rs |
| 5926-5930 | 5 | `export_empty_scene` | tests/export.rs |
| 5932-5961 | 30 | `export_pdf_with_circle` | tests/export.rs |
| 5963-5973 | 11 | `export_pdf_with_stacked_fills` | tests/export.rs |
| 5975-5986 | 12 | `export_pdf_with_strokes` | tests/export.rs |
| 5988-6011 | 24 | `export_pdf_with_effects` | tests/export.rs |
| 6013-6022 | 10 | `export_pdf_no_text_operators` | tests/export.rs |
| 6026-6041 | 16 | `export_pdf_outlines_text` | tests/export_text.rs |
| 6043-6058 | 16 | `export_pdf_outlines_text_multiple_glyphs` | tests/export_text.rs |
| 6060-6066 | 7 | `export_pdf_outlines_text_disabled_by_default` | tests/export_text.rs |
| 6068-6079 | 12 | `export_pdf_outlines_text_empty_string` | tests/export_text.rs |
| 6081-6091 | 11 | `export_pdf_outlines_text_font_data_none_falls_back` | tests/export_text.rs |
| 6093-6115 | 23 | `export_pdf_outlines_text_larger_than_rectangle` | tests/export_text.rs |
| 6117-6177 | 61 | `export_pdf_outlines_text_respects_fill_color` | tests/export_text.rs |
| 6179-6191 | 13 | `export_pdf_outlines_text_multi_font` | tests/export_text.rs |
| 6195-6208 | 14 | `requires_outline_detects_non_winansi` | tests/export_text.rs |
| 6210-6232 | 23 | `export_pdf_outlines_non_winansi_text` | tests/export_text.rs |
| 6234-6265 | 32 | `export_pdf_subsets_extended_latin_as_glyph_paths` | tests/export_text.rs |
| 6269-6278 | 10 | `export_pdf_with_cmyk_profile` | tests/colour.rs |
| 6280-6313 | 34 | `fill_to_color_string_icc_differs_from_analytical` | tests/colour.rs |
| 6336-6346 | 11 | `color_to_cmyk_string_emits_native_channels` | tests/colour.rs |
| 6348-6359 | 12 | `color_to_cmyk_string_bit_depth_scaled` | tests/colour.rs |
| 6361-6366 | 6 | `color_to_stroke_cmyk_string_emits_native_channels` | tests/colour.rs |
| 6368-6395 | 28 | `sample_gradient_cmyk_stops_stay_in_cmyk` | tests/colour.rs |
| 6397-6437 | 41 | `gradient_samples_cmyk_preserve_pure_k` | tests/colour.rs |
| 6549-6566 | 18 | `blend_mode_is_written_as_pdf_graphics_state` | tests/blend_state.rs |
| 6568-6587 | 20 | `searchable_text_fast_path_preserves_node_blend_mode` | tests/blend_state.rs |
| 6589-6607 | 19 | `outlined_text_fast_path_preserves_node_blend_mode` | tests/blend_state.rs |
| 6609-6622 | 14 | `normal_blend_mode_writes_no_blend_state` | tests/blend_state.rs |
| 6624-6641 | 18 | `fill_blend_mode_overrides_the_node_blend_mode` | tests/blend_state.rs |
| 6643-6666 | 24 | `node_and_fill_opacity_multiply_like_the_canvas` | tests/blend_state.rs |
| 6668-6705 | 38 | `node_opacity_is_applied_not_commented` | tests/blend_state.rs |
| 6707-6720 | 14 | `page_keeps_its_neutral_backdrop_instead_of_inventing_paper` | tests/blend_state.rs |
| 6722-6735 | 14 | `screen_over_an_unpainted_area_keeps_the_source_colour` | tests/blend_state.rs |
| 6737-6776 | 40 | `a_mode_without_a_pdf_name_is_reported_not_silently_normalised` | tests/blend_state.rs |
| 6778-6810 | 33 | `drop_shadow_with_a_mode_without_a_pdf_name_is_reported` | tests/blend_state.rs |
| 6812-6822 | 11 | `representable_modes_are_never_reported_as_unrepresented` | tests/blend_state.rs |
## Test helper inventory (14 helpers, source order)

| Source lines | Lines | Helper | Destination |
|---|---:|---|---|
| 3903-3929 | 27 | `rect_node` | tests/support/nodes.rs |
| 3931-3982 | 52 | `text_node` | tests/support/nodes.rs |
| 3984-3986 | 3 | `test_font_data` | tests/support/nodes.rs |
| 3988-4002 | 15 | `solid_fill` | tests/support/nodes.rs |
| 4004-4042 | 39 | `gradient_fill` | tests/support/nodes.rs |
| 4881-4902 | 22 | `image_fill_node` | tests/support/image.rs |
| 4904-4917 | 14 | `image_manifest` | tests/support/image.rs |
| 5075-5100 | 26 | `embedded_image_widths` | tests/support/image.rs |
| 5500-5526 | 27 | `node_with_stroke` | tests/support/inspect.rs |
| 6317-6334 | 18 | `cmyk_color` | tests/support/inspect.rs |
| 6448-6463 | 16 | `page_resources_and_content` | tests/support/inspect.rs |
| 6465-6510 | 46 | `assert_every_graphics_state_precedes_a_paint` | tests/support/inspect.rs |
| 6512-6525 | 14 | `is_paint_operator` | tests/support/inspect.rs |
| 6527-6547 | 21 | `blend_state_names` | tests/support/inspect.rs |


## Destination map and expected module sizes

The destination directory holds one module per cohesive pipeline stage. Each
module is at or under 400 lines (target 350-400 where the stage supports it);
the parent becomes a thin entry. `pdf/resources.rs` carries the "image/colour
resource embedding into resources.rs" concern from ranked row #3 inside the
destination directory, because the root-level `resources.rs` is an existing
frozen sibling that stays in place.

The map below is the review decision. Sizes are moved source lines; module
wiring/import lines are added on top (prelude glob + per-module imports, at most
~14 lines per file) and are measured again after the build.

| Destination module | Source lines moved | Contents |
|---|---:|---|
| `pdf/options.rs` | 52 | PdfOptions, impl PdfOptions |
| `pdf/colour.rs` | 335 | color_to_rgb_string, cmyk_normalized, is_spot_color, spot_color_separation, color_to_cmyk_string, color_to_stroke_rgb_string, color_to_stroke_cmyk_string, check_lossy_color, fill_to_color_string, fill_visible, fill_opacity, fill_blend_mode, blend_is_representable, unrepresented_blend_modes, assert_pdf_blends_are_representable |
| `pdf/paths.rs` | 305 | shape_path_operators, append_path_ring, path_uses_even_odd_fill, path_fill_operator, path_clip_operator, shape_local_bounds, multiply_pdf_affine, apply_pdf_affine, node_affine, shape_pdf_bounds |
| `pdf/geometry.rs` | 314 | image_content_affine, transformed_rect_clip, pdf_image_matrix, PERSPECTIVE_GRID, perspective_quad_valid, bilinear_quad_point, solve_linear3, triangle_affine, inverse_affine, render_perspective_triangles |
| `pdf/resources.rs` | 333 | ImageRenderState, impl ImageRenderState, add_image_render_resources, generate_checkerboard, compute_pdf_image_placement, embed_image, embed_image_with_colorspace, rgba_extract_alpha, rgba_to_rgb |
| `pdf/shading.rs` | 301 | gradient_page_affine, ShadingKind, GradientShadingDef, ShadingRegistry, impl ShadingRegistry, create_sampled_function, sample_gradient |
| `pdf/paint.rs` | 351 | render_strokes, render_effects, effective_fill_alpha, write_fill_graphics_state, write_node_graphics_state, shape_to_pdf_content |
| `pdf/text.rs` | 233 | glyph_outline_to_pdf, build_tj_array, escape_pdf_string, requires_outline, has_non_winansi, shape_text, can_encode_win_ansi, encode_win_ansi, collect_text_per_family, try_outline_node, get_ascender |
| `pdf/fonts.rs` | 234 | EmbeddedFontEntry, font_ascender, read_font_metrics, FontMetrics, embed_font_program, build_to_unicode_cmap |
| `pdf/rich_text.rs` | 210 | RichTextRun, parse_rich_text_runs, render_rich_text_to_pdf |
| `pdf/export.rs` | 362 | export_pdf |
| `pdf/fills_image.rs` | ~344 (extracted arm body 314 + signature/destructure) | render_image_fill (new helper fn wrapping the former FillIR::Image arm body) |
| `pdf/fills_pattern.rs` | ~294 (extracted arm body 266 + signature/destructure) | render_pattern_fill (new helper fn wrapping the former FillIR::Pattern arm body) |
| `pdf/fills.rs` | ~120 after extraction | render_fills dispatcher (Solid and Gradient arms stay inline; loop, visibility check, fallback) |

## Before and expected-after declaration sets

**Before:** 81 declarations + 19 header items in `lib.rs`; 93 tests + 14
helpers + 3 `use` items in the inline tests module. Frozen at 6823 lines.

**After:** 81 declarations distributed across the destination modules (one home
each, no duplicates), 93 tests + 14 helpers distributed across `pdf/tests/`
and `pdf/tests/support/` (one home each), 19 header items either kept in
`lib.rs` (module declarations, `pub use outline`, `pub use blend`,
`test_fonts`, doc comments) or moved once into `pdf/prelude.rs` (private
`use` items), and the 3 `use` items of the tests module merged into the
generated test/support import preambles. `lib.rs` expected <= 120 lines; no
declaration is renamed.

## Public API preservation (crate-root paths unchanged)

| Root name before | Visibility before | After |
|---|---|---|
| `PdfOptions` (+ all pub fields) | `pub` | `pub use pdf::options::PdfOptions;` |
| `export_pdf` | `pub` | thin `pub fn export_pdf` in `lib.rs` delegating to `pdf::export::export_pdf` |
| `embed_image` | `pub` | `pub use pdf::resources::embed_image;` |
| `embed_image_with_colorspace` | `pub` | `pub use pdf::resources::embed_image_with_colorspace;` |
| `rgba_extract_alpha`, `rgba_to_rgb` | `pub` | re-exported from `pdf::resources` |
| `blend_is_representable`, `unrepresented_blend_modes` | `pub` | re-exported from `pdf::colour` |
| `requires_outline`, `has_non_winansi` | `pub` | re-exported from `pdf::text` |
| `ImageRenderState`, `add_image_render_resources`, `assert_pdf_blends_are_representable` | `pub(crate)` | `pub(crate) use` from the new modules |
| `pub mod blend/cmyk/icc/marks/outline/profiles/resources/shaper/subset/test_fonts` | `pub` | unchanged |
| `pub use blend::{...}`, `pub use outline::{...}` | `pub` | unchanged |

External consumers checked: `apps/desktop/src-tauri/src/printing.rs` and
`printing/tests.rs` use `varve_print::PdfOptions`,
`varve_print::export_pdf`, and the existing public modules
(`subset`, `profiles`, `marks`, `cmyk`, `outline_text`,
`commands_to_svg_path`, `shaper`, `test_fonts`); no other crate references
the moving names.

## Planned non-mechanical edits (all behavior-preserving, all counted)

1. **Visibility prefixes.** Any moved item referenced from a different
   destination module or from `pdf/tests/` gains `pub(crate)`; items that
   were `pub` keep `pub`. Before the split every one of them was reachable
   from the whole crate root; the prefixes are the minimum needed to keep the
   same call graph. The exact count is produced by the builder and recorded in
   "Execution results"; no name changes.
2. **`render_fills` arm extraction.** The 726-line `render_fills` cannot fit a
   400-line module. Its `FillIR::Image` match-arm body (source lines
   1462-1775, 314 lines) is lifted into `render_image_fill` in
   `pdf/fills_image.rs`, and its `FillIR::Pattern` body (source lines
   1796-2061, 266 lines) into `render_pattern_fill` in
   `pdf/fills_pattern.rs`. The dispatcher, `FillIR::Solid` arm,
   `FillIR::Gradient` arm and fallback stay in `pdf/fills.rs`. The helper
   parameters are the same locals the arms closed over
   (`node`, `page_height`, `use_cmyk`, `image_state`, `manifest`,
   `profile`, `fill`, `path_ops`, `buf`, plus `lossy` where used). The
   three `continue` statements inside the Pattern arm become early `return`s;
   iteration control is otherwise identical. All other moved body lines are
   byte-identical.
3. **Module wiring.** New files add `use super::prelude::*;` (one shared
   import block: original external imports, crate module aliases, and the
   `resources` manifest module alias) plus per-module sibling imports for items
   referenced across modules. `pdf/mod.rs` declares the modules and
   `#[cfg(test)] mod tests;`.
4. **rustfmt.** `cargo fmt -p varve-print` is run after the move; any reflow it
   performs is listed separately from the byte-identity matrix (moved logical
   lines are compared before formatting, as in B-01/A-07).

## Proof plan (commands and acceptance)

1. **Partition matrix.** For every base line 1-6823, exactly one classification:
   kept in `lib.rs`, moved to exactly one destination module (at the same
   relative position), moved to one test/support module, planned-edit line, or
   dropped blank boundary. Acceptance: 0 unclassified, 0 duplicated, 0 missing
   code lines; every non-blank base line accounted for.
2. **Byte identity.** Compare each moved block's lines against
   `git show b6d8572e3:crates/varve-print/src/lib.rs` with line-range mapping.
   Acceptance: every non-blank non-planned-edit moved line byte-identical
   (allowlist: the 3 `continue`->`return`, the new helper signatures and
   destructuring lines, visibility prefixes, rustfmt reflows); 0 unexplained.
3. **Covering tests.** `cargo test -p varve-print` before: 198 collected / 198
   passed / 0 failed. After: identical collected count and pass count, 0
   failures. Run after extraction and again after formatting.
4. **Compile/type substitution for `check:agent`.** `pnpm check:agent` is
   unavailable (queue EROFS, measured); substitute the same recursive program
   (`node node_modules/typescript/bin/tsc -p packages/*/tsconfig.json`,
   `apps/desktop/tsconfig.json`, `tests/e2e/tsconfig.json`, all
   `--noEmit --pretty false`). Acceptance: 20/20 packages, desktop exit 0,
   e2e exit 0, before and after.
5. **Formatting.** `cargo fmt -p varve-print -- --check` exit 0. Biome does
   not parse Rust; the biome step is a no-op on the changed paths (recorded as
   not applicable with the measured command output).
6. **Baseline ratchet.** `node scripts/quality/audit-file-size.mjs --update`,
   then `pnpm audit:filesize`. Acceptance: exactly
   `crates/varve-print/src/lib.rs` removed; 0 added, 0 grown, 0 lowered
   elsewhere; exit 0 at 953 entries; no `--force`.
7. **Health/docs/emoji audits.** `node scripts/audit-health.mjs`,
   `pnpm audit:docs`, `pnpm audit:emoji` exit 0 (no docs edited; the
   remediation directory is outside `docs/`).
8. **Generated surfaces.** Stage the seam, run `pnpm agent:map` from the
   staged tree, then `pnpm verify:commit`; staged file-size lane must pass
   (all new files <= 400). Then append one ledger row and commit once.

## Edge cases answered

- No module-evaluation side effects exist in the moved region; no statics or
  side-effect imports move.
- Tests are relocated with names/bodies verbatim; the submodule
  `#[cfg(test)]` wiring is the only test-side structural change, and
  `cargo test` still collects all 198.
- The three frozen siblings and the other existing modules are untouched; the
  new `pdf/resources.rs` is a different path and counts as a new (under-cap)
  file.
- `export_pdf`'s public signature is unchanged and its body moves byte-for-byte
  (`pdf/export.rs`); `lib.rs` keeps a one-line delegating wrapper.
- No new dependency, no lockfile change, no package manifest change.
- The destination directory is a single seam: one target file split, one
  baseline entry, one commit.

## STOP conditions

Stop (do not commit) if: any moved base line is unclassified or byte-changed
outside the recorded planned edits; `cargo test -p varve-print` collects fewer
than 198 or any test fails; `lib.rs` stays over 400 lines or a destination file
exceeds 400 lines; the baseline `--update` adds or grows an entry, or removes
anything other than the target; `verify:commit` fails for a staged reason
attributable to this seam; or any session-made change appears outside the seam
paths.

## Visual surface statement

**No visual surface changed.** This is a pure Rust code move in a backend crate;
no rendered UI, canvas, or screenshot exists in the target. Backend PDF bytes
are governed by the crate's existing tests and the unchanged
`fixtures/`/`profiles/` goldens, so the front-end necessity gate and visual
validation are not triggered.
## Execution results (measured on the working tree after the move)

- Destination directory: crates/varve-print/src/pdf/ with 31 new Rust files
  (7,222 lines) plus the crate root. Parent: crates/varve-print/src/lib.rs is
  59 lines (git diff: 6,798 deletions, 17 insertions in the root). Largest
  destination file: pdf/export.rs 378 lines; every seam file is at or under
  400 lines (file-size failures: none).
- Partition/byte-identity matrix (A-07 Rust substitution; raw-string-aware
  scanner; base git show b6d8572e3:crates/varve-print/src/lib.rs): 6,485 moved
  lines verified byte-identical after the recorded de-indent transform; 88
  planned-edit lines verified (46 pub(crate) item prefixes, ShadingRegistry
  methods and definitions/next_id plus GradientShadingDef fields, EmbeddedFontEntry
  fields, prelude pub(crate) use lines, the render_fills declaration and the 3
  continue-to-return lines); 207 dropped lines, all blank; 43 structural lines
  are exactly the two arm-destructuring wrapper blocks plus the test-module
  wiring lines; 0 unclassified lines and 0 mismatches. All 27 FillIR arm fields
  are reproduced in the helper destructures (image 11, pattern 16). 81/81
  declarations exactly once; 93 tests plus 14 helpers exactly once in pdf/tests.
- rustfmt: cargo fmt -p varve-print run once; cargo fmt -p varve-print -- --check
  exits 0. Formatting-only proof: 42 files compared pre/post with the
  identifier/string/number-literal token streams identical after normalizing
  rustfmt's use/module reordering; 3,407 line positions were reformatted and
  total lines went 11,312 (pre-format) to 11,261; no semantic token changed.
- Covering tests: cargo test -p varve-print before the move: 198 collected,
  198 passed, 0 failed, 0 ignored, 0 doc-tests. After the move (pre-format):
  identical 198/198/0. After formatting: identical 198/198/0. No test was
  edited, skipped, weakened, or added.
- check:agent substitute (queued gate unavailable: pnpm check:agent exits 1 with
  EROFS on /run/user/1000/varve-validation-queue/exclusive.lock). The same
  recursive program as check:agent:raw was run directly
  (node node_modules/typescript/bin/tsc -p packages/*/tsconfig.json, then
  apps/desktop/tsconfig.json, then tests/e2e/tsconfig.json, all --noEmit
  --pretty false), before and after: packages-checked=20 packages-fail=0,
  desktop-exit=2, e2e-exit=0 both times. The desktop failure is a pre-existing
  environment condition, not this seam: 228 diagnostics reference stale
  @varve workspace resolution into other worktrees (for example
  .worktrees/marketing-S3-URL/packages/engine/src/fontRegistry), no TypeScript
  file is touched by this seam, and the exit code is identical before and
  after. The direct Vitest substitute was also probed for the next entry
  (node node_modules/vitest/vitest.mjs run
  packages/editor/src/clipboard.test.ts): 40/40 passed, exit 0.
- Biome: Rust paths are not supported by Biome; the measured output for the
  changed paths is "These paths were provided but ignored" (exit 1), so the
  Biome step is a recorded no-op for this seam.
- Audits: node scripts/audit-health.mjs exit 0; pnpm audit:docs clean (1,307
  docs, 1,054 links, 183 ADRs); pnpm audit:emoji clean (5,650 files).
- Baseline: node scripts/quality/audit-file-size.mjs --update reports added 0,
  grown 0, removed 1 (crates/varve-print/src/lib.rs), 954 -> 953 frozen
  entries. pnpm audit:filesize exits 0: 6,155 source files scanned, 953 frozen,
  0 stale, 0 violations, 310,287 excess lines.
- Public surface: all previously public crate-root names are re-exported at the
  same paths (PdfOptions, export_pdf, embed_image, embed_image_with_colorspace,
  rgba_extract_alpha, rgba_to_rgb, blend_is_representable,
  unrepresented_blend_modes, requires_outline, has_non_winansi); the existing
  pub mod and pub use outline/blend surface is unchanged; the pub(crate) names
  used by sibling modules (add_image_render_resources, ImageRenderState,
  shape_to_pdf_content, collect_text_per_family,
  assert_pdf_blends_are_representable) are re-exported pub(crate).
- No visual surface changed; the front-end necessity gate and visual
  validation were not triggered. Backend PDF bytes are governed by the
  unchanged crate test suite and the untouched fixtures/ and profiles/ inputs.
