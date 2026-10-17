// Analytic-coverage shape stage for the native Varve IR rasterizer.
//
// Every drawable here is instanced: one instance per IR item, six vertices per
// instance covering a quad that is the item's local-space bounds expanded by
// ~1.5 device pixels so the antialiased band has geometry to land on.
//
// Coverage comes from a signed distance evaluated in the item's LOCAL space.
// The local coordinate is interpolated rather than reconstructed from an
// inverse matrix, so `fwidth(distance)` is the exact local-space size of one
// device pixel regardless of rotation, skew, or non-uniform scale.
//
// Authoring constraints that are deliberate and load-bearing:
//  * No runtime-indexed vector component writes (`v[i] = ...`). Naga lowers
//    those to HLSL that FXC rejects (X3550 + X3511) and wgpu 30's DX12 backend
//    defaults to FXC. See docs/research/native-gpu-canvas-research-2026-10-16.md.
//  * No divergent control flow before a derivative. Loops have a constant trip
//    count and every selection is a `select`, so all invocations in a quad
//    execute identically and `fwidth` is well defined.
//  * No workgroup shared memory at all, so the "two invocations writing
//    different components of one shared vector" hazard cannot arise.

struct Item {
  // local -> device-pixel affine, already premultiplied by the camera view.
  mv: vec4<f32>, // a, b, c, d
  mv2: vec4<f32>, // e, f, unused, unused
  // local-space quad: x, y, w, h (bounds expanded by the AA margin)
  quad: vec4<f32>,
  // kind, vertex count, convex flag, unused
  shape: vec4<u32>,
  // rect: x, y, w, h
  // ellipse/circle: cx, cy, rx, ry
  // polygon/star: cx, cy, outer radius, rotation
  p0: vec4<f32>,
  // star: inner radius, unused, unused, unused
  p1: vec4<f32>,
  // rect corner radii: top-left, top-right, bottom-right, bottom-left
  radii: vec4<f32>,
  // straight (non-premultiplied) encoded-sRGB rgba, 0..1
  color: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> items: array<Item>;

// Viewport in device pixels: (width, height, unused, unused). Device-pixel
// coordinates are what the plan carries, so the clip-space mapping lives here
// rather than being folded into every record.
@group(0) @binding(1) var<uniform> viewport: vec4<f32>;

fn to_clip(device: vec2<f32>) -> vec2<f32> {
  // WebGPU NDC is +Y up while framebuffer row 0 is the top row, so the Y term
  // is inverted here rather than at readback.
  return vec2<f32>(device.x / viewport.x * 2.0 - 1.0, 1.0 - device.y / viewport.y * 2.0);
}

const KIND_RECT: u32 = 0u;
const KIND_ELLIPSE: u32 = 1u;
const KIND_REGULAR: u32 = 2u;
const KIND_STAR: u32 = 3u;

// Matches MAX_SHAPE_VERTICES in plan.rs. Fixed so the loop trip count is
// constant and the derivative context stays uniform.
const MAX_VERTICES: u32 = 24u;

const TAU: f32 = 6.28318530717958647692;

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) instance: u32,
};

@vertex
fn vs_shape(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VsOut {
  // Constant indices only: no dynamic vector lane access.
  var corner = vec2<f32>(0.0, 0.0);
  switch vertex_index {
    case 0u: { corner = vec2<f32>(0.0, 0.0); }
    case 1u: { corner = vec2<f32>(1.0, 0.0); }
    case 2u: { corner = vec2<f32>(0.0, 1.0); }
    case 3u: { corner = vec2<f32>(0.0, 1.0); }
    case 4u: { corner = vec2<f32>(1.0, 0.0); }
    default: { corner = vec2<f32>(1.0, 1.0); }
  }

  let item = items[instance_index];
  let local = item.quad.xy + corner * item.quad.zw;
  let clip = vec2<f32>(
    item.mv.x * local.x + item.mv.z * local.y + item.mv2.x,
    item.mv.y * local.x + item.mv.w * local.y + item.mv2.y,
  );

  var out: VsOut;
  out.clip = vec4<f32>(to_clip(clip), 0.0, 1.0);
  out.local = local;
  out.instance = instance_index;
  return out;
}

fn sd_round_rect(p: vec2<f32>, center: vec2<f32>, half: vec2<f32>, radii: vec4<f32>) -> f32 {
  // Per-corner radius chosen with `select` so the lanes stay converged.
  let d = p - center;
  let right = d.x >= 0.0;
  let bottom = d.y >= 0.0;
  let top_pair = select(radii.x, radii.y, right);
  let bottom_pair = select(radii.w, radii.z, right);
  let radius = clamp(select(top_pair, bottom_pair, bottom), 0.0, min(half.x, half.y));

  let q = abs(d) - (half - vec2<f32>(radius, radius));
  let outside = length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0);
  return outside - radius;
}

fn sd_ellipse(p: vec2<f32>, center: vec2<f32>, r: vec2<f32>) -> f32 {
  let d = p - center;
  let safe = max(r, vec2<f32>(1e-6, 1e-6));
  let k1 = length(d / safe);
  // First-order distance correction; |grad| of (|p/r| - 1) is |p / r^2| / |p/r|.
  let k2 = length(d / (safe * safe));
  return (k1 - 1.0) / max(k2, 1e-6);
}

// One vertex of a regular polygon (`star = false`) or of an alternating
// outer/inner star (`star = true`). `index` is taken modulo the ring length,
// so callers need no special case for the closing edge.
fn ring_vertex(
  center: vec2<f32>,
  outer: f32,
  inner: f32,
  rotation: f32,
  points: u32,
  index: u32,
  star: bool,
) -> vec2<f32> {
  let ring = select(max(points, 3u), max(points, 3u) * 2u, star);
  let step = TAU / f32(ring);
  let wrapped = index % ring;
  let angle = rotation + step * f32(wrapped);
  let alternates = (wrapped & 1u) == 0u;
  let radius = select(outer, select(inner, outer, alternates), star);
  return center + radius * vec2<f32>(cos(angle), sin(angle));
}

fn distance_to_segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ab = b - a;
  let denom = max(dot(ab, ab), 1e-12);
  let t = clamp(dot(p - a, ab) / denom, 0.0, 1.0);
  return length(p - (a + t * ab));
}

fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return a.x * b.y - a.y * b.x;
}

// Signed distance to a regular polygon or star. Branch-free: every lane in the
// quad walks the same fixed-length loop so the caller may take derivatives.
fn sd_ring(
  p: vec2<f32>,
  center: vec2<f32>,
  outer: f32,
  inner: f32,
  rotation: f32,
  points: u32,
  star: bool,
) -> f32 {
  let ring = select(max(points, 3u), max(points, 3u) * 2u, star);
  var nearest = 1e30;
  var winding = 0.0;

  for (var i = 0u; i < MAX_VERTICES; i = i + 1u) {
    let in_range = i < ring;
    let a = ring_vertex(center, outer, inner, rotation, points, i, star);
    let b = ring_vertex(center, outer, inner, rotation, points, i + 1u, star);
    let edge = b - a;

    let seg = distance_to_segment(p, a, b);
    nearest = select(nearest, min(nearest, seg), in_range);

    // Crossing-number winding, evaluated without branches.
    let upward = select(0.0, 1.0, a.y <= p.y);
    let downward = 1.0 - upward;
    let crosses_up = select(0.0, 1.0, b.y > p.y);
    let crosses_down = select(0.0, 1.0, b.y <= p.y);
    let side = cross2(edge, p - a);
    let positive = select(0.0, 1.0, side > 0.0);
    let negative = select(0.0, 1.0, side < 0.0);
    let contribution = select(0.0, 1.0, in_range);
    winding =
      winding + contribution * (upward * crosses_up * positive - downward * crosses_down * negative);
  }

  let inside = winding != 0.0;
  return select(sqrt(nearest + 1e-12), -sqrt(nearest + 1e-12), inside);
}

@fragment
fn fs_shape(input: VsOut) -> @location(0) vec4<f32> {
  let item = items[input.instance];
  let kind = item.shape.x;
  let count = item.shape.y;
  let convex = item.shape.z == 1u;

  var distance: f32;
  if (kind == KIND_RECT) {
    let half = 0.5 * item.p0.zw;
    let center = item.p0.xy + half;
    distance = sd_round_rect(input.local, center, half, item.radii);
  } else if (kind == KIND_ELLIPSE) {
    distance = sd_ellipse(input.local, item.p0.xy, item.p0.zw);
  } else {
    let star = kind == KIND_STAR;
    if (convex) {
      // Regular convex polygon: max over the inward half-planes is exact and
      // far cheaper than the winding form. Same fixed trip count.
      var best = -1e30;
      for (var i = 0u; i < MAX_VERTICES; i = i + 1u) {
        let in_range = i < count;
        let a = ring_vertex(item.p0.xy, item.p0.z, item.p1.x, item.p0.w, count, i, star);
        let b = ring_vertex(item.p0.xy, item.p0.z, item.p1.x, item.p0.w, count, i + 1u, star);
        let edge = b - a;
        let inward = normalize(vec2<f32>(-edge.y, edge.x));
        let orient = select(1.0, -1.0, dot(inward, item.p0.xy - a) < 0.0);
        let plane = dot(input.local - a, inward * orient);
        best = select(best, max(best, plane), in_range);
      }
      distance = best;
    } else {
      distance = sd_ring(
        input.local,
        item.p0.xy,
        item.p0.z,
        item.p1.x,
        item.p0.w,
        count,
        star,
      );
    }
  }

  // `distance` is branch-free above this point; taking the derivative here is
  // therefore defined for every lane in the quad.
  let width = max(fwidth(distance), 1e-6);
  let coverage = clamp(0.5 - distance / width, 0.0, 1.0);
  let alpha = item.color.a * coverage;

  // Premultiplied output; the pipeline blends with (One, OneMinusSrcAlpha) so
  // the stored encoded-sRGB values composite exactly like Canvas2D source-over.
  return vec4<f32>(item.color.rgb * alpha, alpha);
}
