// Debug axes: line-list, per-vertex colour (geometry.js → axes()).

struct Uniforms {
  mvp: mat4x4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
};

@vertex
fn vs(@location(0) position: vec3f, @location(1) color: vec3f) -> VSOut {
  var out: VSOut;
  out.pos = u.mvp * vec4f(position, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return toOutput(vec4f(in.color, 1.0));
}