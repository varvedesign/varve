#!/usr/bin/env node
/**
 * IPC contract audit — reviewed allowlists.
 *
 * Both lists are deliberately fail-closed: entries are exact command names or
 * files, and anything not listed fails the audit. Reasons are required and are
 * printed by --report so the debt cannot hide.
 */

const HOME_PHASE_GAP_REASON =
  'Home Phase 1-3 native command: implemented only by the web/memory Platform adapters; no Rust #[tauri::command] exists, so desktop invoke() rejects. Pre-existing defect, not fixed by this audit.';

export { HOME_PHASE_GAP_REASON };

/**
 * Pre-existing TS -> Rust mismatches. Every entry is a command name with no Rust
 * definition today. If Rust ever defines one, the audit fails until the entry is
 * removed (stale allowlist). New unmatched invokes fail.
 */
export const KNOWN_NATIVE_GAPS = new Map(
  [
    'home_add_file_collection',
    'home_create_asset_folder',
    'home_create_branch',
    'home_create_collection',
    'home_create_folder',
    'home_create_library',
    'home_create_project_template',
    'home_create_saved_search',
    'home_create_template',
    'home_create_workspace',
    'home_delete_asset',
    'home_delete_asset_folder',
    'home_delete_collection',
    'home_delete_folder',
    'home_delete_library',
    'home_delete_saved_search',
    'home_delete_template',
    'home_delete_workspace',
    'home_enable_library',
    'home_import_asset',
    'home_list_activity',
    'home_list_assets',
    'home_list_branches',
    'home_list_collection_files',
    'home_list_collections',
    'home_list_drafts',
    'home_list_folders',
    'home_list_libraries',
    'home_list_permissions',
    'home_list_project_templates',
    'home_list_saved_searches',
    'home_list_templates',
    'home_list_workspaces',
    'home_move_drafts',
    'home_move_file_folder',
    'home_move_project_workspace',
    'home_promote_drafts',
    'home_record_activity',
    'home_remove_file_collection',
    'home_rename_folder',
    'home_rename_workspace',
    'home_reorder_collection',
    'home_reorder_folder',
    'home_search_assets',
    'home_search_file_content',
    'home_search_templates',
    'home_set_permission',
    'home_update_collection',
  ].map((name) => [name, HOME_PHASE_GAP_REASON]),
);

/** Dynamic-name call sites. File -> { maxSites, reason }. */
export const DYNAMIC_CALL_ALLOWLIST = new Map([
  [
    'packages/editor/src/components/SpecPanel/export.ts',
    {
      maxSites: 1,
      reason:
        'Chooses export_pdfx1a vs export_pdfx4 into a command variable before invoke; both names are Rust commands and are covered by this audit through print/native.ts.',
    },
  ],
  [
    'packages/engine/src/font/fontStorageFs.ts',
    {
      maxSites: 1,
      reason:
        'tauriInvoke(cmd, args) is the shared font-storage transport; callers select the command name (store/load/list/remove/release/usage). The wrapper is reviewed with the font-storage commands.',
    },
  ],
  [
    'packages/engine/src/shapingBackend.ts',
    {
      maxSites: 1,
      reason:
        'Injected NativeShapeInvoker port; the default implementation is local and invokes the literal shape_text_command.',
    },
  ],
  [
    'packages/print/src/native.ts',
    {
      maxSites: 1,
      reason:
        'Chooses export_pdfx1a / export_pdfx4 / export_pdf_with_options into a command variable; all three names are Rust commands.',
    },
  ],
]);
