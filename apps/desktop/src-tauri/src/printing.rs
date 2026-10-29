//! PDF/PDF-X export, text outline/shaping and native print commands (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::filesystem;
use crate::stubs::check_scene_node_bounds;
use crate::stubs::convert_scene;
use serde::Deserialize;
use serde::Serialize;
use varve_bridge::IpcSceneNode;

// ── PDF export ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ExportPdfOptions {
    pub(crate) page_width: f64,
    pub(crate) page_height: f64,
    pub(crate) title: String,
    pub(crate) author: String,
    pub(crate) outline_text: bool,
    pub(crate) subset_fonts: bool,
    pub(crate) font_data: Option<Vec<u8>>,
    #[serde(default)]
    pub(crate) fonts: Vec<(String, Vec<u8>)>,
}

impl Default for ExportPdfOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Varve Export".into(),
            author: "Varve".into(),
            outline_text: false,
            subset_fonts: false,
            font_data: None,
            fonts: Vec::new(),
        }
    }
}

#[tauri::command]
pub(crate) fn export_node_pdf(
    nodes: Vec<IpcSceneNode>,
    opts: Option<ExportPdfOptions>,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    check_scene_node_bounds(&nodes)?;
    let scene = convert_scene(nodes);
    let pdf_opts = opts.unwrap_or_default();
    let mut print_opts = varve_print::PdfOptions {
        page_width: pdf_opts.page_width,
        page_height: pdf_opts.page_height,
        title: pdf_opts.title,
        author: pdf_opts.author,
        outline_text: pdf_opts.outline_text,
        subset_fonts: pdf_opts.subset_fonts,
        font_data: pdf_opts.font_data,
        fonts: pdf_opts.fonts,
        ..Default::default()
    };
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());
    varve_print::export_pdf(&scene, &print_opts)
}

// ── PDF/X and text outlining commands ────────────────────

/// Options for PDF/X export, deserialized from the TS bridge's options JSON.
#[derive(Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct PdfXOptions {
    pub(crate) page_width: f64,
    pub(crate) page_height: f64,
    pub(crate) title: String,
    pub(crate) author: String,
    pub(crate) bleed_mm: f64,
    pub(crate) include_crop_marks: bool,
    pub(crate) include_registration_marks: bool,
    pub(crate) enforce_dpi: f64,
    pub(crate) outline_text: bool,
    pub(crate) icc_profile: String,
    pub(crate) color_bars: bool,
    pub(crate) format: String,
    pub(crate) font_data: Option<Vec<u8>>,
    #[serde(default)]
    pub(crate) fonts: Vec<(String, Vec<u8>)>,
    #[serde(default)]
    pub(crate) subset_fonts: bool,
}

impl Default for PdfXOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Varve Export".into(),
            author: "Varve".into(),
            bleed_mm: 3.0,
            include_crop_marks: false,
            include_registration_marks: false,
            enforce_dpi: 300.0,
            outline_text: false,
            icc_profile: "Fogra39".into(),
            color_bars: false,
            format: "screen".into(),
            font_data: None,
            fonts: Vec::new(),
            subset_fonts: false,
        }
    }
}

impl PdfXOptions {
    fn to_pdf_options(&self, page_height: f64) -> varve_print::PdfOptions {
        varve_print::PdfOptions {
            page_width: self.page_width,
            page_height,
            title: self.title.clone(),
            author: self.author.clone(),
            outline_text: self.outline_text,
            font_data: self.font_data.clone(),
            fonts: self.fonts.clone(),
            registration_marks: self.include_registration_marks,
            color_bar: self.color_bars,
            print_profile: self.print_profile(),
            subset_fonts: self.subset_fonts || self.outline_text,
            embedding_restriction_handling: varve_print::subset::EmbeddingRestriction::Warn,
            manifest: None,
            lossy: false,
        }
    }

    /// Resolve the requested ICC print profile from the `iccProfile` option.
    /// Unknown profile names return `None` — the caller's preflight must have
    /// surfaced the mismatch; we never guess a different profile silently.
    fn print_profile(&self) -> Option<varve_print::profiles::PrintProfile> {
        varve_print::profiles::PrintProfile::parse(&self.icc_profile)
    }

    /// Build print-mark geometry when bleed or crop marks are requested. The
    /// engine draws crop marks and derives the bleed boxes from this geometry,
    /// so `include_crop_marks` and `bleed_mm` are honored together (the PDF/X
    /// builders only receive a `MarksGeometry`, never a bare bleed value).
    fn marks_geometry(&self) -> Option<varve_print::marks::MarksGeometry> {
        let bleed = self.bleed_mm.max(0.0);
        if !self.include_crop_marks && bleed <= 0.0 {
            return None;
        }
        Some(varve_print::marks::MarksGeometry {
            bleed_mm: if bleed > 0.0 {
                bleed
            } else {
                varve_print::marks::MarksGeometry::default().bleed_mm
            },
            draw_crop_marks: self.include_crop_marks,
            trim_offset_mm: if self.include_crop_marks {
                varve_print::marks::MarksGeometry::default().trim_offset_mm
            } else {
                0.0
            },
            mark_length_mm: if self.include_crop_marks {
                varve_print::marks::MarksGeometry::default().mark_length_mm
            } else {
                0.0
            },
            ..Default::default()
        })
    }
}

fn parse_nodes_from_json(nodes_json: &str) -> Result<Vec<varve_core::SceneNode>, String> {
    let nodes: Vec<IpcSceneNode> =
        serde_json::from_str(nodes_json).map_err(|e| format!("Nodes JSON parse error: {e}"))?;
    check_scene_node_bounds(&nodes)?;
    Ok(convert_scene(nodes))
}

#[tauri::command]
pub(crate) fn export_pdfx1a(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    options_json: String,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Options JSON parse error: {e}"))?;
    let mut print_opts = opts.to_pdf_options(page_height);
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());
    if let Some(geo) = opts.marks_geometry() {
        varve_print::cmyk::export_pdfx1a_with_marks(&scene, &print_opts, &geo)
    } else {
        varve_print::cmyk::export_pdfx1a(&scene, &print_opts)
    }
}

#[tauri::command]
pub(crate) fn export_pdfx4(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    options_json: String,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Options JSON parse error: {e}"))?;
    let mut print_opts = opts.to_pdf_options(page_height);
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());
    if let Some(geo) = opts.marks_geometry() {
        varve_print::cmyk::export_pdfx4_with_marks(&scene, &print_opts, &geo)
    } else {
        varve_print::cmyk::export_pdfx4(&scene, &print_opts)
    }
}

#[tauri::command]
pub(crate) fn outline_text(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    text: String,
    font_data: Vec<u8>,
    font_size: f64,
) -> Result<String, String> {
    let fonts = &font_data;
    let outlines = varve_print::outline_text(fonts, &text, font_size)?;
    let mut path = String::new();
    for glyph in &outlines {
        let d = varve_print::commands_to_svg_path(&glyph.commands, 2);
        if !d.is_empty() {
            if !path.is_empty() {
                path.push(' ');
            }
            path.push_str(&d);
        }
    }
    Ok(path)
}

#[tauri::command]
pub(crate) fn shape_text_command(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    request_json: String,
) -> Result<String, String> {
    let request: varve_print::shaper::ShapeRequest = serde_json::from_str(&request_json)
        .map_err(|e| format!("Shape request parse error: {e}"))?;
    let result = varve_print::shaper::shape_text(&request)?;
    serde_json::to_string(&result).map_err(|e| format!("Shape result serialize error: {e}"))
}

#[tauri::command]
pub(crate) fn export_pdf_with_options(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    use_cmyk: bool,
    options_json: String,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Options JSON parse error: {e}"))?;
    let mut print_opts = opts.to_pdf_options(page_height);
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());

    match opts.format.as_str() {
        "x1a" | "pdf-x1a" => varve_print::cmyk::export_pdfx1a(&scene, &print_opts),
        "x4" | "pdf-x4" => varve_print::cmyk::export_pdfx4(&scene, &print_opts),
        _ if use_cmyk => varve_print::cmyk::export_pdfx1a(&scene, &print_opts),
        _ => varve_print::export_pdf(&scene, &print_opts),
    }
}
// ── Native Print ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub(crate) struct PrinterInfo {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) is_color: bool,
    pub(crate) paper_sizes: Vec<String>,
    pub(crate) supports_duplex: bool,
    pub(crate) accepting_jobs: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PrintOptions {
    pub(crate) printer_name: String,
    pub(crate) copies: Option<u32>,
    pub(crate) duplex: Option<bool>,
    pub(crate) color_mode: Option<String>,
    pub(crate) page_size: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PrintResult {
    pub(crate) job_id: u32,
    pub(crate) message: String,
    pub(crate) success: bool,
}

#[tauri::command]
pub(crate) fn list_printers() -> Vec<PrinterInfo> {
    crate::print::list_printers()
        .into_iter()
        .map(|p| PrinterInfo {
            name: p.name,
            description: p.description,
            is_color: p.is_color,
            paper_sizes: p.paper_sizes,
            supports_duplex: p.supports_duplex,
            accepting_jobs: p.accepting_jobs,
        })
        .collect()
}

#[tauri::command]
pub(crate) fn print_pdf(
    app: tauri::AppHandle,
    pdf_data: Vec<u8>,
    job_title: String,
    options: PrintOptions,
) -> PrintResult {
    let temporary = match filesystem::AppDirectories::resolve(&app) {
        Ok(directories) => directories.temporary,
        Err(error) => {
            return PrintResult {
                job_id: 0,
                message: error.message,
                success: false,
            };
        }
    };
    if let Err(error) = std::fs::create_dir_all(&temporary) {
        return PrintResult {
            job_id: 0,
            message: format!("Failed to create print staging directory: {error}"),
            success: false,
        };
    }
    let result = crate::print::print_pdf(
        &temporary,
        &options.printer_name,
        &pdf_data,
        &job_title,
        crate::print::PrintSettings {
            copies: options.copies.unwrap_or(1),
            duplex: options.duplex.unwrap_or(false),
            color_mode: options.color_mode.unwrap_or_else(|| "color".to_string()),
            page_size: options.page_size.unwrap_or_else(|| "auto".to_string()),
        },
    );
    PrintResult {
        job_id: result.job_id,
        message: result.message,
        success: result.success,
    }
}

#[tauri::command]
pub(crate) fn cancel_print_job(printer_name: String, job_id: u32) -> Result<String, String> {
    crate::print::cancel_job(&printer_name, job_id)
}

// ── End Native Print ────────────────────────────────────────────────────
