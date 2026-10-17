// Solid-colour stage for the stencil-and-cover path pipeline.
//
// The same pipeline is used three ways, distinguished by pipeline state rather
// than by shader entry point:
//   1. stencil fan, non-zero fill rule  (colour writes disabled, IncrWrap/DecrWrap)
//   2. stencil fan, even-odd fill rule  (colour writes disabled, Invert/Invert)
//   3. cover quad                        (stencil test != 0, reset to 0 on pass)
//
// Positions arrive already transformed to clip space by the CPU, so this stage
// contains no matrix math and no derivatives.

// Viewport in device pixels: (width, height, unused, unused). The plan carries
// device-pixel positions, so the clip-space mapping happens here.
@group(0) @binding(0) var<uniform> viewport: vec4<f32>;

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_solid(@location(0) position: vec2<f32>, @location(1) color: vec4<f32>) -> VsOut {
  var out: VsOut;
  let device = vec2<f32>(
    position.x / viewport.x * 2.0 - 1.0,
    1.0 - position.y / viewport.y * 2.0,
  );
  out.clip = vec4<f32>(device, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_solid(input: VsOut) -> @location(0) vec4<f32> {
  // Straight-alpha input, premultiplied output; the pipeline blends with
  // (One, OneMinusSrcAlpha) over encoded-sRGB values, matching Canvas2D.
  let alpha = input.color.a;
  return vec4<f32>(input.color.rgb * alpha, alpha);
}
