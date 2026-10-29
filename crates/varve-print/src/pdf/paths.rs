//! Shape path operators, bounds, and affine helpers for PDF output.

use super::prelude::*;

/// Extract PDF path operators (m, l, c, re, h) for the given shape node,
/// WITHOUT fill/stroke operators or color. Returns bytes suitable for
/// use by `render_fills`, `render_strokes`, and `render_effects`.
///
/// Coordinates are in PDF space (Y-up) with the affine translation applied.
pub(crate) fn shape_path_operators(node: &SceneNode, page_height: f64) -> Vec<u8> {
    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];

    match &node.shape {
        Shape::Rect(r) => {
            let x = r.min_x() + x_off;
            let y = page_height - r.max_y() - y_off;
            let w = r.width();
            let h = r.height();
            format!("{x:.2} {y:.2} {w:.2} {h:.2} re\n").into_bytes()
        }
        Shape::Circle(c) => {
            let cx = c.center.x + x_off;
            let cy = page_height - c.center.y - y_off;
            let r = c.radius;
            format!("{cx:.2} {cy:.2} {r:.2} 0 360 arc\n").into_bytes()
        }
        Shape::Ellipse { center, rx, ry } => {
            let cx = center.x + x_off;
            let cy = page_height - center.y - y_off;
            format!("{cx:.2} {cy:.2} {rx:.2} {ry:.2} 0 360 arc\n").into_bytes()
        }
        Shape::Line { line, tolerance: _ } => {
            let x1 = line.p0.x + x_off;
            let y1 = page_height - line.p0.y - y_off;
            let x2 = line.p1.x + x_off;
            let y2 = page_height - line.p1.y - y_off;
            format!("{x1:.2} {y1:.2} m\n{x2:.2} {y2:.2} l\n").into_bytes()
        }
        Shape::Polygon {
            cx,
            cy,
            radius,
            sides,
            rotation,
        } => {
            let scx = cx + x_off;
            let scy = page_height - cy - y_off;
            let mut buf = Vec::new();
            for i in 0..*sides {
                let a = 2.0 * std::f64::consts::PI * i as f64 / *sides as f64
                    - std::f64::consts::FRAC_PI_2
                    + rotation;
                let px = scx + radius * a.cos();
                let py = scy + radius * a.sin();
                if i == 0 {
                    buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
                } else {
                    buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
                }
            }
            buf.extend_from_slice(b"h\n");
            buf
        }
        Shape::Star {
            cx,
            cy,
            inner_radius,
            outer_radius,
            points,
            rotation,
        } => {
            let scx = cx + x_off;
            let scy = page_height - cy - y_off;
            let mut buf = Vec::new();
            let total = points * 2;
            for i in 0..total {
                let a = std::f64::consts::PI * i as f64 / *points as f64
                    - std::f64::consts::FRAC_PI_2
                    + rotation;
                let r = if i % 2 == 0 {
                    *outer_radius
                } else {
                    *inner_radius
                };
                let px = scx + r * a.cos();
                let py = scy + r * a.sin();
                if i == 0 {
                    buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
                } else {
                    buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
                }
            }
            buf.extend_from_slice(b"h\n");
            buf
        }
        Shape::Arrow { from, to, .. } => {
            let x0 = from[0] + x_off;
            let y0 = page_height - from[1] - y_off;
            let x1 = to[0] + x_off;
            let y1 = page_height - to[1] - y_off;
            format!("{x0:.2} {y0:.2} m\n{x1:.2} {y1:.2} l\n").into_bytes()
        }
        Shape::Path {
            points,
            closed,
            contours,
            holes,
            ..
        } => {
            // Same ring resolution as the TS replay: authored `contours`
            // supersede `points` + `holes` when non-empty.
            let rings = compound_path_rings(points, contours, holes);
            if rings.is_empty() {
                return Vec::new();
            }
            let mut buf = Vec::new();
            let primary_closed = !contours.is_empty() || *closed;
            append_path_ring(
                &mut buf,
                rings[0],
                primary_closed,
                page_height,
                x_off,
                y_off,
            );
            for ring in rings.iter().skip(1) {
                append_path_ring(&mut buf, ring, true, page_height, x_off, y_off);
            }
            buf
        }
        // Native tables are compiled by the editor render layer before print
        // export; a raw table shape prints as nothing here.
        Shape::Table(_) => Vec::new(),
        Shape::Text { x, y, w, h, .. } => {
            let px = x + x_off;
            let py = page_height - y - h - y_off;
            format!("{px:.2} {py:.2} {w:.2} {h:.2} re\n").into_bytes()
        }
    }
}

/// Append one local-space path contour to a PDF path stream.
///
/// Holes are emitted as independent subpaths so the caller can select the
/// appropriate nonzero/even-odd fill rule. Handles are converted to PDF's
/// Y-up control-point coordinates alongside their endpoints.
fn append_path_ring(
    buf: &mut Vec<u8>,
    points: &[varve_core::PathPoint],
    closed: bool,
    page_height: f64,
    x_off: f64,
    y_off: f64,
) {
    if points.is_empty() {
        return;
    }
    for (i, pt) in points.iter().enumerate() {
        let px = pt.x + x_off;
        let py = page_height - pt.y - y_off;
        if i == 0 {
            buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
        } else {
            let prev = &points[i - 1];
            let prev_px = prev.x + x_off;
            let prev_py = page_height - prev.y - y_off;
            if prev.handle_out.is_some() || pt.handle_in.is_some() {
                let cp1x = prev
                    .handle_out
                    .map_or(prev_px, |handle| prev_px + handle[0]);
                let cp1y = prev
                    .handle_out
                    .map_or(prev_py, |handle| prev_py - handle[1]);
                let cp2x = pt.handle_in.map_or(px, |handle| px + handle[0]);
                let cp2y = pt.handle_in.map_or(py, |handle| py - handle[1]);
                buf.extend(
                    format!("{cp1x:.2} {cp1y:.2} {cp2x:.2} {cp2y:.2} {px:.2} {py:.2} c\n")
                        .as_bytes(),
                );
            } else {
                buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
            }
        }
    }
    if closed {
        buf.extend_from_slice(b"h\n");
    }
}

fn path_uses_even_odd_fill(node: &SceneNode) -> bool {
    match &node.shape {
        Shape::Path {
            contours,
            holes,
            fill_rule,
            ..
        } => {
            compound_path_fill_rule(fill_rule.as_deref(), contours.len(), holes.len())
                == PathFillRule::EvenOdd
        }
        _ => false,
    }
}

pub(crate) fn path_fill_operator(node: &SceneNode) -> &'static [u8] {
    if path_uses_even_odd_fill(node) {
        b"f*\n"
    } else {
        b"f\n"
    }
}

pub(crate) fn path_clip_operator(node: &SceneNode) -> &'static [u8] {
    if path_uses_even_odd_fill(node) {
        b"W* n\n"
    } else {
        b"W n\n"
    }
}

pub(crate) fn shape_local_bounds(node: &SceneNode) -> (f64, f64, f64, f64) {
    match &node.shape {
        Shape::Rect(r) => (r.min_x(), r.min_y(), r.width(), r.height()),
        Shape::Circle(c) => (
            c.center.x - c.radius,
            c.center.y - c.radius,
            2.0 * c.radius,
            2.0 * c.radius,
        ),
        Shape::Ellipse { center, rx, ry } => (center.x - rx, center.y - ry, 2.0 * rx, 2.0 * ry),
        Shape::Line { line, .. } => (
            line.p0.x.min(line.p1.x),
            line.p0.y.min(line.p1.y),
            (line.p0.x - line.p1.x).abs(),
            (line.p0.y - line.p1.y).abs(),
        ),
        Shape::Polygon { cx, cy, radius, .. } => {
            (cx - radius, cy - radius, 2.0 * radius, 2.0 * radius)
        }
        Shape::Star {
            cx,
            cy,
            outer_radius,
            ..
        } => (
            cx - outer_radius,
            cy - outer_radius,
            2.0 * outer_radius,
            2.0 * outer_radius,
        ),
        Shape::Arrow { from, to, .. } => (
            from[0].min(to[0]),
            from[1].min(to[1]),
            (from[0] - to[0]).abs(),
            (from[1] - to[1]).abs(),
        ),
        Shape::Path {
            points,
            contours,
            holes,
            ..
        } => {
            // Bounds span every draw ring: a compound path's `points` can be
            // empty while `contours` carries the geometry.
            let rings = compound_path_rings(points, contours, holes);
            let mut min_x = f64::INFINITY;
            let mut max_x = f64::NEG_INFINITY;
            let mut min_y = f64::INFINITY;
            let mut max_y = f64::NEG_INFINITY;
            let mut seen = false;
            for ring in &rings {
                for p in ring.iter() {
                    seen = true;
                    min_x = min_x.min(p.x);
                    max_x = max_x.max(p.x);
                    min_y = min_y.min(p.y);
                    max_y = max_y.max(p.y);
                }
            }
            if !seen {
                return (0.0, 0.0, 0.0, 0.0);
            }
            (min_x, min_y, max_x - min_x, max_y - min_y)
        }
        Shape::Text { x, y, w, h, .. } => (*x, *y, *w, *h),
        Shape::Table(_) => (0.0, 0.0, 0.0, 0.0),
    }
}

pub(crate) fn multiply_pdf_affine(lhs: [f64; 6], rhs: [f64; 6]) -> [f64; 6] {
    [
        lhs[0] * rhs[0] + lhs[2] * rhs[1],
        lhs[1] * rhs[0] + lhs[3] * rhs[1],
        lhs[0] * rhs[2] + lhs[2] * rhs[3],
        lhs[1] * rhs[2] + lhs[3] * rhs[3],
        lhs[0] * rhs[4] + lhs[2] * rhs[5] + lhs[4],
        lhs[1] * rhs[4] + lhs[3] * rhs[5] + lhs[5],
    ]
}

pub(crate) fn apply_pdf_affine(matrix: [f64; 6], x: f64, y: f64) -> (f64, f64) {
    (
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5],
    )
}

pub(crate) fn node_affine(node: &SceneNode) -> [f64; 6] {
    node.transform.as_coeffs()
}

pub(crate) fn shape_pdf_bounds(node: &SceneNode, page_height: f64) -> (f64, f64, f64, f64) {
    let (x, y, w, h) = shape_local_bounds(node);
    let matrix = node_affine(node);
    let corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)];
    let points = corners.map(|(px, py)| {
        let (world_x, world_y) = apply_pdf_affine(matrix, px, py);
        (world_x, page_height - world_y)
    });
    let min_x = points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let max_x = points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let max_y = points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    (min_x, min_y, max_x - min_x, max_y - min_y)
}
