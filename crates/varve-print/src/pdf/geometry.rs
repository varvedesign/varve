//! Perspective geometry, image matrices, and triangle-mesh rendering.

use super::paths::{apply_pdf_affine, multiply_pdf_affine, node_affine, shape_local_bounds};
use super::prelude::*;
use super::resources::{compute_pdf_image_placement, ImageRenderState};

pub(crate) fn image_content_affine(
    node: &SceneNode,
    draw_x: f64,
    draw_y: f64,
    draw_w: f64,
    draw_h: f64,
    rotation: f64,
    flip_h: bool,
    flip_v: bool,
) -> [f64; 6] {
    let radians = rotation.to_radians();
    let (sin, cos) = radians.sin_cos();
    let sx = if flip_h { -1.0 } else { 1.0 };
    let sy = if flip_v { -1.0 } else { 1.0 };
    let linear = [cos * sx, sin * sx, -sin * sy, cos * sy, 0.0, 0.0];
    let cx = draw_x + draw_w / 2.0;
    let cy = draw_y + draw_h / 2.0;
    let around_center = [
        linear[0],
        linear[1],
        linear[2],
        linear[3],
        cx - linear[0] * cx - linear[2] * cy,
        cy - linear[1] * cx - linear[3] * cy,
    ];
    multiply_pdf_affine(node_affine(node), around_center)
}

pub(crate) fn transformed_rect_clip(
    matrix: [f64; 6],
    page_height: f64,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> String {
    let corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)];
    let points = corners.map(|(px, py)| {
        let (world_x, world_y) = apply_pdf_affine(matrix, px, py);
        (world_x, page_height - world_y)
    });
    let first = points[0];
    let mut result = format!("{:.4} {:.4} m\n", first.0, first.1);
    for point in &points[1..] {
        result.push_str(&format!("{:.4} {:.4} l\n", point.0, point.1));
    }
    result.push_str("h W n\n");
    result
}

pub(crate) fn pdf_image_matrix(
    matrix: [f64; 6],
    page_height: f64,
    draw_x: f64,
    draw_y: f64,
    draw_w: f64,
    draw_h: f64,
) -> [f64; 6] {
    // Image XObjects occupy a unit square whose sample rows run top-to-bottom.
    // Map that square into y-down node-local coordinates, then through the
    // complete local→world affine and finally into PDF's y-up page space.
    let (origin_x, origin_y) = apply_pdf_affine(matrix, draw_x, draw_y + draw_h);
    [
        matrix[0] * draw_w,
        -matrix[1] * draw_w,
        -matrix[2] * draw_h,
        matrix[3] * draw_h,
        origin_x,
        page_height - origin_y,
    ]
}

pub(crate) const PERSPECTIVE_GRID: usize = 8;

fn perspective_quad_valid(quad: &[[f64; 2]; 4]) -> bool {
    if quad.iter().flatten().any(|v| !v.is_finite()) {
        return false;
    }
    let mut sign = 0.0;
    for i in 0..4 {
        let a = quad[i];
        let b = quad[(i + 1) % 4];
        let c = quad[(i + 2) % 4];
        let cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if cross.abs() < 1e-9 {
            return false;
        }
        if sign == 0.0 {
            sign = cross.signum();
        } else if cross.signum() != sign {
            return false;
        }
    }
    sign != 0.0
}

fn bilinear_quad_point(quad: &[[f64; 2]; 4], u: f64, v: f64) -> [f64; 2] {
    let top = [
        quad[0][0] + (quad[1][0] - quad[0][0]) * u,
        quad[0][1] + (quad[1][1] - quad[0][1]) * u,
    ];
    let bottom = [
        quad[3][0] + (quad[2][0] - quad[3][0]) * u,
        quad[3][1] + (quad[2][1] - quad[3][1]) * u,
    ];
    [
        top[0] + (bottom[0] - top[0]) * v,
        top[1] + (bottom[1] - top[1]) * v,
    ]
}

fn solve_linear3(mut matrix: [[f64; 4]; 3]) -> Option<[f64; 3]> {
    for column in 0..3 {
        let mut pivot = column;
        for row in (column + 1)..3 {
            if matrix[row][column].abs() > matrix[pivot][column].abs() {
                pivot = row;
            }
        }
        if matrix[pivot][column].abs() < 1e-12 {
            return None;
        }
        matrix.swap(column, pivot);
        let divisor = matrix[column][column];
        for value in &mut matrix[column][column..4] {
            *value /= divisor;
        }
        for row in 0..3 {
            if row == column {
                continue;
            }
            let factor = matrix[row][column];
            let pivot_row = matrix[column];
            for (offset, value) in matrix[row][column..4].iter_mut().enumerate() {
                let index = column + offset;
                *value -= factor * pivot_row[index];
            }
        }
    }
    Some([matrix[0][3], matrix[1][3], matrix[2][3]])
}

/// Affine map from three source points to three PDF destination points.
/// PDF's `cm` is affine-only, so the projective quad is subdivided into small
/// source/destination triangles and each triangle clips the shared image XObject.
fn triangle_affine(src: [[f64; 2]; 3], dst: [[f64; 2]; 3]) -> Option<[f64; 6]> {
    let x = [
        [src[0][0], src[0][1], 1.0, dst[0][0]],
        [src[1][0], src[1][1], 1.0, dst[1][0]],
        [src[2][0], src[2][1], 1.0, dst[2][0]],
    ];
    let y = [
        [src[0][0], src[0][1], 1.0, dst[0][1]],
        [src[1][0], src[1][1], 1.0, dst[1][1]],
        [src[2][0], src[2][1], 1.0, dst[2][1]],
    ];
    let [a, c, e] = solve_linear3(x)?;
    let [b, d, f] = solve_linear3(y)?;
    Some([a, b, c, d, e, f])
}

fn inverse_affine(matrix: [f64; 6]) -> Option<[f64; 6]> {
    let det = matrix[0] * matrix[3] - matrix[2] * matrix[1];
    if !det.is_finite() || det.abs() < 1e-12 {
        return None;
    }
    let a = matrix[3] / det;
    let b = -matrix[1] / det;
    let c = -matrix[2] / det;
    let d = matrix[0] / det;
    Some([
        a,
        b,
        c,
        d,
        -(a * matrix[4] + c * matrix[5]),
        -(b * matrix[4] + d * matrix[5]),
    ])
}

pub(crate) fn render_perspective_triangles(
    node: &SceneNode,
    page_height: f64,
    image_name: &str,
    image_width: f64,
    image_height: f64,
    fit: &str,
    fill_x: f64,
    fill_y: f64,
    fill_scale: f64,
    crop: Option<(f64, f64, f64, f64)>,
    rotation: f64,
    flip_h: bool,
    flip_v: bool,
    opacity: f64,
    quad: &[[f64; 2]; 4],
    state: &mut ImageRenderState<'_>,
) -> String {
    if !perspective_quad_valid(quad)
        || image_width <= 0.0
        || image_height <= 0.0
        || !image_width.is_finite()
        || !image_height.is_finite()
    {
        return String::new();
    }
    let (bounds_x, bounds_y, bounds_w, bounds_h) = shape_local_bounds(node);
    if bounds_w <= 0.0 || bounds_h <= 0.0 {
        return String::new();
    }
    let (draw_w, draw_h, draw_ox, draw_oy) = compute_pdf_image_placement(
        fit,
        image_width,
        image_height,
        bounds_w,
        bounds_h,
        fill_scale,
    );
    if draw_w <= 0.0 || draw_h <= 0.0 {
        return String::new();
    }
    let draw_x = bounds_x + fill_x + draw_ox;
    let draw_y = bounds_y + fill_y + draw_oy;
    let sample = crop.unwrap_or((0.0, 0.0, image_width, image_height));
    let sample_draw = (
        draw_x + sample.0 / image_width * draw_w,
        draw_y + sample.1 / image_height * draw_h,
        sample.2 / image_width * draw_w,
        sample.3 / image_height * draw_h,
    );
    if sample_draw.2 <= 0.0 || sample_draw.3 <= 0.0 {
        return String::new();
    }

    let radians = rotation.to_radians();
    let (sin, cos) = radians.sin_cos();
    let sx = if flip_h { -1.0 } else { 1.0 };
    let sy = if flip_v { -1.0 } else { 1.0 };
    let linear = [cos * sx, sin * sx, -sin * sy, cos * sy, 0.0, 0.0];
    let cx = draw_x + draw_w / 2.0;
    let cy = draw_y + draw_h / 2.0;
    let content = [
        linear[0],
        linear[1],
        linear[2],
        linear[3],
        cx - linear[0] * cx - linear[2] * cy,
        cy - linear[1] * cx - linear[3] * cy,
    ];
    let inverse = match inverse_affine(content) {
        Some(value) => value,
        None => return String::new(),
    };

    let mut grid = vec![vec![[0.0; 2]; PERSPECTIVE_GRID + 1]; PERSPECTIVE_GRID + 1];
    for (row, grid_row) in grid.iter_mut().enumerate() {
        for (col, cell) in grid_row.iter_mut().enumerate() {
            let u = col as f64 / PERSPECTIVE_GRID as f64;
            let v = row as f64 / PERSPECTIVE_GRID as f64;
            let local = [bounds_x + bounds_w * u, bounds_y + bounds_h * v];
            let untransformed = apply_pdf_affine(inverse, local[0], local[1]);
            let source_x =
                sample.0 + ((untransformed.0 - sample_draw.0) / sample_draw.2) * sample.2;
            let source_y =
                sample.1 + ((untransformed.1 - sample_draw.1) / sample_draw.3) * sample.3;
            *cell = [source_x, source_y];
        }
    }

    let mut result = String::new();
    if opacity < 1.0 {
        let gs_name = state.get_or_create_opacity_gs(opacity);
        result.push_str(&format!("/{gs_name} gs\n"));
    }
    let world_matrix = node_affine(node);
    for (row, rows) in grid.windows(2).enumerate() {
        let top = &rows[0];
        let bottom = &rows[1];
        for (col, _) in top.iter().enumerate().take(PERSPECTIVE_GRID) {
            let u0 = col as f64 / PERSPECTIVE_GRID as f64;
            let u1 = (col + 1) as f64 / PERSPECTIVE_GRID as f64;
            let v0 = row as f64 / PERSPECTIVE_GRID as f64;
            let v1 = (row + 1) as f64 / PERSPECTIVE_GRID as f64;
            let destinations = [
                bilinear_quad_point(quad, u0, v0),
                bilinear_quad_point(quad, u1, v0),
                bilinear_quad_point(quad, u1, v1),
                bilinear_quad_point(quad, u0, v1),
            ];
            let sources = [top[col], top[col + 1], bottom[col + 1], bottom[col]];
            let triangles = [(0, 1, 3), (1, 2, 3)];
            for (a, b, c) in triangles {
                let source_triangle = [sources[a], sources[b], sources[c]];
                let destination_triangle = [destinations[a], destinations[b], destinations[c]];
                let destination_page = destination_triangle.map(|point| {
                    let (world_x, world_y) = apply_pdf_affine(world_matrix, point[0], point[1]);
                    [world_x, page_height - world_y]
                });
                let source_triangle_normalized = source_triangle.map(|point| {
                    [
                        (point[0] / image_width).clamp(0.0, 1.0),
                        1.0 - (point[1] / image_height).clamp(0.0, 1.0),
                    ]
                });
                let Some(matrix) = triangle_affine(source_triangle_normalized, destination_page)
                else {
                    continue;
                };
                let clip = source_triangle_normalized;
                result.push_str("q\n");
                result.push_str(&format!(
                    "{:.6} {:.6} {:.6} {:.6} {:.6} {:.6} cm\n",
                    matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]
                ));
                result.push_str(&format!(
                    "{:.6} {:.6} m\n{:.6} {:.6} l\n{:.6} {:.6} l\nh W n\n/{image_name} Do\nQ\n",
                    clip[0][0], clip[0][1], clip[1][0], clip[1][1], clip[2][0], clip[2][1]
                ));
            }
        }
    }
    result
}
