// Debug curve: draws a line-strip or point-list with a single flat colour.

struct Uniforms {
  mvp: mat4x4f,
  color: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return u.mvp * vec4f(position, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
  return toOutput(u.color);
}