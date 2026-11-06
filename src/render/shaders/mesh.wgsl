// Simple lit mesh shader for cube objects (Part A).
// Each object has its own uniform: the MVP matrix and a flat colour.

struct Uniforms {
  mvp: mat4x4f,
  color: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) normal: vec3f,
};

@vertex
fn vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> VSOut {
  var out: VSOut;
  out.pos = u.mvp * vec4f(position, 1.0);
  out.normal = normal;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // one fixed directional light, just enough to read the cube's faces
  let light = normalize(vec3f(0.4, 0.8, 0.6));
  let diffuse = max(dot(normalize(in.normal), light), 0.15);
  return vec4f(u.color.rgb * diffuse, u.color.a);
}