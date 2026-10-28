use crate::support::validate;

// ---- gpuAccelerator.ts ----

const SEPARABLE_BLUR_H_WGSL: &str = r#"
struct Uniforms {
  width: i32,
  height: i32,
  radius: i32,
  kernelSize: i32,
  kernel: array<f32, 128>,
};

@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<storage, read> uniforms: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = i32(id.x);
  let y = i32(id.y);
  if (x >= uniforms.width || y >= uniforms.height) { return; }

  var sum = 0.0;
  for (var k = -uniforms.radius; k <= uniforms.radius; k++) {
    let sx = clamp(x + k, 0, uniforms.width - 1);
    let idx = y * uniforms.width + sx;
    let kv = uniforms.kernel[k + uniforms.radius];
    sum += input[idx] * kv;
  }
  output[y * uniforms.width + x] = sum;
}
"#;

const SEPARABLE_BLUR_V_WGSL: &str = r#"
struct Uniforms {
  width: i32,
  height: i32,
  radius: i32,
  kernelSize: i32,
  kernel: array<f32, 128>,
};

@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<storage, read> uniforms: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = i32(id.x);
  let y = i32(id.y);
  if (x >= uniforms.width || y >= uniforms.height) { return; }

  var sum = 0.0;
  for (var k = -uniforms.radius; k <= uniforms.radius; k++) {
    let sy = clamp(y + k, 0, uniforms.height - 1);
    let idx = sy * uniforms.width + x;
    let kv = uniforms.kernel[k + uniforms.radius];
    sum += input[idx] * kv;
  }
  output[y * uniforms.width + x] = sum;
}
"#;

#[test]
fn separable_blur_h_wgsl() {
    validate(
        SEPARABLE_BLUR_H_WGSL,
        "separableBlurH (gpuAccelerator)",
        true,
    );
}

#[test]
fn separable_blur_v_wgsl() {
    validate(
        SEPARABLE_BLUR_V_WGSL,
        "separableBlurV (gpuAccelerator)",
        true,
    );
}
