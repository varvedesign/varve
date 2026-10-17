//! Shapes and point-containment for hit-testing.
//!
//! Shapes are defined in a node's LOCAL space; the hit-test layer transforms a
//! world-space pointer into local space before calling `contains`.

use crate::geom::{point_to_segment_dist_sq, Circle, Line, Point, Rect};

/// A single point in a bezier path (mirrors TS `PathPoint`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PathPoint {
    pub x: f64,
    pub y: f64,
    #[serde(rename = "handleIn")]
    pub handle_in: Option<[f64; 2]>,
    #[serde(rename = "handleOut")]
    pub handle_out: Option<[f64; 2]>,
    /// Optional editor semantic; rendering only needs the handles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

/// First-pass shape set. Bézier paths arrive with the lyon integration.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[allow(clippy::large_enum_variant)]
pub enum Shape {
    Rect(Rect),
    /// Axis-aligned ellipse (center + semi-axes).
    Ellipse {
        center: Point,
        rx: f64,
        ry: f64,
    },
    Circle(Circle),
    /// A stroked segment; hit if the pointer is within `tolerance` of the line.
    Line {
        line: Line,
        tolerance: f64,
    },
    /// Regular polygon (equilateral, centered).
    Polygon {
        cx: f64,
        cy: f64,
        radius: f64,
        sides: u32,
        rotation: f64,
    },
    /// Star shape (alternating inner/outer vertices).
    Star {
        cx: f64,
        cy: f64,
        inner_radius: f64,
        outer_radius: f64,
        points: u32,
        rotation: f64,
    },
    /// Directed line segment with an arrowhead at the `to` end.
    Arrow {
        from: [f64; 2],
        to: [f64; 2],
        tolerance: f64,
        #[serde(rename = "arrowheadSize")]
        arrowhead_size: f64,
    },
    /// Bezier path (open or closed). Compound fills carry `contours` (canonical,
    /// authored outer-first) and/or legacy `holes`, plus an optional `fill_rule`.
    Path {
        points: Vec<PathPoint>,
        closed: bool,
        tolerance: f64,
        /// Canonical compound-path rings in authored order (outer first).
        /// Mirrors TS `Primitive.path.contours`; when non-empty it supersedes
        /// `points` + `holes` exactly like `pathRings` in the TS replay.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        contours: Vec<Vec<PathPoint>>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        holes: Vec<Vec<PathPoint>>,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "fillRule")]
        fill_rule: Option<String>,
    },
    #[serde(rename = "text")]
    Text {
        text: String,
        #[serde(rename = "fontSize")]
        font_size: f64,
        #[serde(rename = "fontFamily")]
        font_family: String,
        #[serde(rename = "fontWeight")]
        font_weight: u16,
        #[serde(rename = "fontStyle")]
        font_style: String,
        #[serde(rename = "textAlign")]
        text_align: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "textAlignVertical")]
        text_align_vertical: Option<String>,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "letterSpacing")]
        letter_spacing: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "lineHeight")]
        line_height: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "paragraphSpacing")]
        paragraph_spacing: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "textCase")]
        text_case: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "textDecoration")]
        text_decoration: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "textOverflow")]
        text_overflow: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "listStyle")]
        list_style: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "richText")]
        rich_text: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "openTypeFeatures")]
        open_type_features: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "variableAxes")]
        variable_axes: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "textMode")]
        text_mode: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "pathTextSettings")]
        path_text_settings: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "pathShape")]
        path_shape: Option<serde_json::Value>,
    },
    /// V2.15+: compiled native table (ADR-0016 D3). The payload is opaque to
    /// varve-core; the editor layout engine compiles it and JS replay paints
    /// it. Rust passes it through the IR unchanged.
    Table(serde_json::Value),
}

/// Fill rule for a compound-path fill, mirroring TS `FillRule`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathFillRule {
    NonZero,
    EvenOdd,
}

/// Draw rings for a compound path, mirroring `pathRings` in
/// `packages/engine/src/pathCompound.ts`: authored `contours` win when
/// non-empty; otherwise the primary ring plus legacy `holes`. Rings with
/// fewer than two points are dropped, exactly like the TS filter.
pub fn compound_path_rings<'a>(
    points: &'a [PathPoint],
    contours: &'a [Vec<PathPoint>],
    holes: &'a [Vec<PathPoint>],
) -> Vec<&'a [PathPoint]> {
    if !contours.is_empty() {
        return contours
            .iter()
            .map(Vec::as_slice)
            .filter(|r| r.len() >= 2)
            .collect();
    }
    let mut rings = vec![points];
    rings.extend(holes.iter().map(Vec::as_slice));
    rings.into_iter().filter(|r| r.len() >= 2).collect()
}

/// Fill rule for a compound path, mirroring `pathFillRule` in
/// `packages/engine/src/pathCompound.ts`: an explicit rule wins; a
/// multi-contour path or a holes-carrying path defaults to even-odd;
/// everything else is non-zero.
pub fn compound_path_fill_rule(
    explicit: Option<&str>,
    contour_count: usize,
    hole_count: usize,
) -> PathFillRule {
    if let Some(rule) = explicit {
        if rule.eq_ignore_ascii_case("evenodd") {
            return PathFillRule::EvenOdd;
        }
        return PathFillRule::NonZero;
    }
    if contour_count > 1 || hole_count > 0 {
        PathFillRule::EvenOdd
    } else {
        PathFillRule::NonZero
    }
}

impl Shape {
    /// Does this shape contain `pt` (in local space)?
    pub fn contains(&self, pt: Point) -> bool {
        match self {
            Shape::Rect(r) => crate::geom::rect_contains(*r, pt),
            Shape::Ellipse { center, rx, ry } => point_in_ellipse(*center, *rx, *ry, pt),
            Shape::Circle(c) => c.center.distance(pt) <= c.radius,
            Shape::Line { line, tolerance } => {
                point_to_segment_dist_sq(*line, pt) <= tolerance * tolerance
            }
            Shape::Polygon {
                cx,
                cy,
                radius,
                sides,
                rotation,
            } => {
                let verts = polygon_vertices(*cx, *cy, *radius, *sides, *rotation);
                point_in_polygon(&verts, pt)
            }
            Shape::Star {
                cx,
                cy,
                inner_radius,
                outer_radius,
                points,
                rotation,
            } => {
                let verts =
                    star_vertices(*cx, *cy, *inner_radius, *outer_radius, *points, *rotation);
                point_in_polygon(&verts, pt)
            }
            Shape::Arrow {
                from,
                to,
                tolerance,
                ..
            } => {
                let line = Line::new(Point::new(from[0], from[1]), Point::new(to[0], to[1]));
                point_to_segment_dist_sq(line, pt) <= tolerance * tolerance
            }
            Shape::Path {
                points,
                closed,
                tolerance,
                contours,
                holes,
                fill_rule,
            } => {
                if points.is_empty() && contours.is_empty() {
                    return false;
                }
                let rings = compound_path_rings(points, contours, holes);
                let primary_open = contours.is_empty() && !*closed;
                if !primary_open && rings.iter().any(|r| r.len() >= 3) {
                    let fill_evenodd = compound_path_fill_rule(
                        fill_rule.as_deref(),
                        contours.len(),
                        holes.len(),
                    ) == PathFillRule::EvenOdd;
                    let mut crossings = 0u32;
                    let mut winding = 0i32;
                    for ring in &rings {
                        accumulate_polygon_hit(ring, pt, &mut crossings, &mut winding);
                    }
                    if fill_evenodd {
                        crossings % 2 == 1
                    } else {
                        winding != 0
                    }
                } else {
                    // Open path: hit if within tolerance of any segment.
                    for ring in &rings {
                        for i in 0..ring.len().saturating_sub(1) {
                            let a = Point::new(ring[i].x, ring[i].y);
                            let b = Point::new(ring[i + 1].x, ring[i + 1].y);
                            let line = Line::new(a, b);
                            if point_to_segment_dist_sq(line, pt) <= tolerance * tolerance {
                                return true;
                            }
                        }
                    }
                    false
                }
            }
            Shape::Table(_) => false,
            Shape::Text { x, y, w, h, .. } => {
                crate::geom::rect_contains(Rect::new(*x, *y, *x + *w, *y + *h), pt)
            }
        }
    }
}

fn polygon_vertices(cx: f64, cy: f64, radius: f64, sides: u32, rotation: f64) -> Vec<Point> {
    let mut verts = Vec::with_capacity(sides as usize);
    for i in 0..sides {
        let a = 2.0 * std::f64::consts::PI * i as f64 / sides as f64 - std::f64::consts::FRAC_PI_2
            + rotation;
        verts.push(Point::new(cx + radius * a.cos(), cy + radius * a.sin()));
    }
    verts
}

fn star_vertices(
    cx: f64,
    cy: f64,
    inner_radius: f64,
    outer_radius: f64,
    points: u32,
    rotation: f64,
) -> Vec<Point> {
    let total = (points * 2) as usize;
    let mut verts = Vec::with_capacity(total);
    for i in 0..total {
        let a = std::f64::consts::PI * i as f64 / points as f64 - std::f64::consts::FRAC_PI_2
            + rotation;
        let r = if i % 2 == 0 {
            outer_radius
        } else {
            inner_radius
        };
        verts.push(Point::new(cx + r * a.cos(), cy + r * a.sin()));
    }
    verts
}

fn accumulate_polygon_hit(points: &[PathPoint], pt: Point, crossings: &mut u32, winding: &mut i32) {
    if points.len() < 3 {
        return;
    }
    for i in 0..points.len() {
        let a = &points[i];
        let b = &points[(i + 1) % points.len()];
        if (a.y > pt.y) != (b.y > pt.y) {
            let x_intersect = a.x + ((pt.y - a.y) * (b.x - a.x)) / (b.y - a.y);
            if x_intersect > pt.x {
                *crossings += 1;
                *winding += if a.y > pt.y { 1 } else { -1 };
            }
        }
    }
}

fn point_in_polygon(vertices: &[Point], pt: Point) -> bool {
    let mut inside = false;
    let mut j = vertices.len() - 1;
    for i in 0..vertices.len() {
        if (vertices[i].y > pt.y) != (vertices[j].y > pt.y)
            && pt.x
                < (vertices[j].x - vertices[i].x) * (pt.y - vertices[i].y)
                    / (vertices[j].y - vertices[i].y)
                    + vertices[i].x
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn point_in_ellipse(center: Point, rx: f64, ry: f64, pt: Point) -> bool {
    let dx = (pt.x - center.x) / rx;
    let dy = (pt.y - center.y) / ry;
    dx * dx + dy * dy <= 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_contains_corners_and_interior() {
        let r = Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0));
        assert!(r.contains(Point::new(5.0, 5.0)));
        assert!(r.contains(Point::new(0.0, 0.0))); // closed
        assert!(r.contains(Point::new(10.0, 10.0)));
        assert!(!r.contains(Point::new(10.01, 5.0)));
        assert!(!r.contains(Point::new(-0.01, 5.0)));
    }

    #[test]
    fn circle_contains_within_radius() {
        let c = Shape::Circle(Circle::new(Point::new(0.0, 0.0), 5.0));
        assert!(c.contains(Point::new(3.0, 3.0)));
        assert!(c.contains(Point::new(5.0, 0.0)));
        assert!(!c.contains(Point::new(3.6, 3.6)));
    }

    #[test]
    fn ellipse_contains() {
        let e = Shape::Ellipse {
            center: Point::new(0.0, 0.0),
            rx: 10.0,
            ry: 4.0,
        };
        assert!(e.contains(Point::new(9.0, 0.0)));
        assert!(e.contains(Point::new(0.0, 3.0)));
        assert!(!e.contains(Point::new(0.0, 4.5)));
        assert!(!e.contains(Point::new(10.5, 0.0)));
    }

    #[test]
    fn line_hit_within_tolerance() {
        let l = Shape::Line {
            line: Line::new(Point::new(0.0, 0.0), Point::new(10.0, 0.0)),
            tolerance: 2.0,
        };
        assert!(l.contains(Point::new(5.0, 1.5)));
        assert!(!l.contains(Point::new(5.0, 2.5)));
        assert!(l.contains(Point::new(-1.0, 1.0))); // projects onto endpoint
    }

    fn ring(points: &[(f64, f64)]) -> Vec<PathPoint> {
        points
            .iter()
            .map(|(x, y)| PathPoint {
                x: *x,
                y: *y,
                handle_in: None,
                handle_out: None,
                mode: None,
            })
            .collect()
    }

    #[test]
    fn compound_rings_prefer_contours_and_mirror_the_ts_filter() {
        let points = ring(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]);
        let contours = vec![
            ring(&[(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]),
            ring(&[(4.0, 4.0), (8.0, 4.0), (8.0, 8.0)]),
            ring(&[(30.0, 30.0)]), // degenerate: dropped like the TS filter
        ];
        let holes = vec![ring(&[(99.0, 99.0), (100.0, 99.0), (100.0, 100.0)])];
        let rings = compound_path_rings(&points, &contours, &holes);
        assert_eq!(rings.len(), 2, "contours win; degenerate ring filtered");
        assert_eq!(rings[0].len(), 4);
        assert_eq!(rings[1].len(), 3);
        assert!(
            !rings.iter().any(|r| r[0].x == 99.0),
            "holes must be ignored when contours are present"
        );

        let legacy = compound_path_rings(&points, &[], &holes);
        assert_eq!(legacy.len(), 2, "holes remain the legacy fallback");
    }

    #[test]
    fn compound_fill_rule_matches_the_replay_derivation() {
        assert_eq!(
            compound_path_fill_rule(Some("nonzero"), 2, 0),
            PathFillRule::NonZero,
            "an explicit rule always wins"
        );
        assert_eq!(
            compound_path_fill_rule(None, 2, 0),
            PathFillRule::EvenOdd,
            "multi-contour without a rule is even-odd"
        );
        assert_eq!(
            compound_path_fill_rule(None, 0, 1),
            PathFillRule::EvenOdd,
            "holes without a rule stay even-odd (legacy behaviour)"
        );
        assert_eq!(
            compound_path_fill_rule(None, 1, 0),
            PathFillRule::NonZero,
            "single contour defaults to non-zero"
        );
    }

    #[test]
    fn hit_test_honors_contours_rings() {
        // Outer square with a hole and an island inside the hole, all through
        // `contours` — the boolean-result shape this contract exists for.
        let shape = Shape::Path {
            points: Vec::new(),
            closed: true,
            tolerance: 1.0,
            contours: vec![
                ring(&[(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)]),
                ring(&[(10.0, 10.0), (30.0, 10.0), (30.0, 30.0), (10.0, 30.0)]),
                ring(&[(15.0, 15.0), (25.0, 15.0), (25.0, 25.0), (15.0, 25.0)]),
            ],
            holes: Vec::new(),
            fill_rule: None,
        };
        assert!(shape.contains(Point::new(5.0, 20.0)), "outer band hits");
        assert!(
            !shape.contains(Point::new(12.0, 20.0)),
            "hole misses (evenodd default for multi-contour)"
        );
        assert!(shape.contains(Point::new(20.0, 20.0)), "island hits");
        assert!(
            !shape.contains(Point::new(-1.0, 20.0)),
            "outside the outer ring misses"
        );
    }

    #[test]
    fn path_json_roundtrips_contours() {
        // Core `Shape` is externally tagged (the `kind`-tagged wire format
        // lives in varve-bridge's IpcShape, tested there); this pins the
        // field-level contract: contours deserialize and re-serialize, and an
        // absent holes field is not invented.
        let json = r#"{"Path": {
            "points": [],
            "closed": true,
            "tolerance": 4,
            "contours": [
                [{"x":0,"y":0,"handleIn":null,"handleOut":null},
                 {"x":40,"y":0,"handleIn":null,"handleOut":null},
                 {"x":40,"y":40,"handleIn":null,"handleOut":null}],
                [{"x":10,"y":10,"handleIn":null,"handleOut":null},
                 {"x":30,"y":10,"handleIn":null,"handleOut":null},
                 {"x":30,"y":30,"handleIn":null,"handleOut":null}]
            ],
            "fillRule": "evenodd"
        }}"#;
        let shape: Shape = serde_json::from_str(json).expect("contours deserialize");
        let Shape::Path { contours, .. } = &shape else {
            panic!("expected a path");
        };
        assert_eq!(contours.len(), 2, "contours survive the wire");
        assert!(
            !json_wire_has_field(&shape, "holes"),
            "holes stay absent when only contours were sent"
        );

        // And the serialized form keeps them for the next consumer.
        let wire = serde_json::to_string(&shape).expect("serialize");
        assert!(wire.contains("\"contours\":["));
    }

    fn json_wire_has_field(shape: &Shape, field: &str) -> bool {
        serde_json::to_value(shape)
            .ok()
            .and_then(|v| v.get(field).is_some().then_some(()))
            .is_some()
    }
}
