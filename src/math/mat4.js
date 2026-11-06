/**
 * mat4 — 4×4 matrices for Parts A and C.
 *
 * CONVENTIONS (the tests check exactly these):
 *   • A matrix is a Float32Array(16) in COLUMN-MAJOR order — the layout WebGPU
 *     expects for a mat4x4f in a uniform buffer. Element (row r, column c)
 *     lives at index  c * 4 + r.  The translation of an affine matrix is
 *     therefore at indices 12, 13, 14.
 *   • Column vectors: a point p is transformed as  M · p.
 *     multiply(A, B) returns A·B, so B is applied FIRST.
 *   • Right-handed world space. Angles in RADIANS. A positive angle rotates
 *     counter-clockwise when you look down the axis towards the origin
 *     (rotateZ(π/2) takes +x to +y).
 *   • View space: the camera sits at the origin and looks down −z, +y is up.
 *   • Clip space is WebGPU's: after the divide by w, x and y are in [−1, 1]
 *     and z is in [0, 1] (near → 0, far → 1). NOT OpenGL's [−1, 1].
 *
 * No maths libraries (no gl-matrix, no Three.js). Tests: tests/mat4.test.js
 */
import { todo } from './todo.js';

/* ------------------------------------------------------------- Part A ---- */

/** The 4×4 identity. */
export function identity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}
/** A · B (apply B first, then A). Must not modify a or b. */
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = sum;
    }
  }
  return o;
}

/** Translation by (tx, ty, tz). */
export function translate(tx, ty, tz) {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1]);
}

/** Rotation by `rad` about the x axis. */
export function rotateX(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
}
/** Rotation by `rad` about the y axis. */
export function rotateY(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
}
/** Rotation by `rad` about the z axis. */
export function rotateZ(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
}


/** Non-uniform scale by (sx, sy, sz). */
export function scale(sx, sy, sz) {
  return new Float32Array([sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1]);
}

/** Mᵀ */
export function transpose(m) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[r * 4 + c] = m[c * 4 + r];
  return o;
}

/**
 * Inverse of a RIGID transform M = T·R (rotation + translation only, no scale).
 * Do not write a general 4×4 inverse: use the structure (Week 3).
 */
export function invertRigid(m) {
  // rotation part is the top-left 3x3, transpose it
  const r00=m[0], r01=m[4], r02=m[8];
  const r10=m[1], r11=m[5], r12=m[9];
  const r20=m[2], r21=m[6], r22=m[10];
  const tx=m[12], ty=m[13], tz=m[14];
  // Rᵀ
  const o = new Float32Array([
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    0,0,0,1
  ]);
  // new translation = −Rᵀ · t
  o[12] = -(r00*tx + r10*ty + r20*tz);
  o[13] = -(r01*tx + r11*ty + r21*tz);
  o[14] = -(r02*tx + r12*ty + r22*tz);
  return o;
}
/** M · v for a 4-component v = [x, y, z, w]; returns [x', y', z', w']. */
export function transformVec4(m, v) {
  const [x,y,z,w] = v;
  return [
    m[0]*x + m[4]*y + m[8]*z  + m[12]*w,
    m[1]*x + m[5]*y + m[9]*z  + m[13]*w,
    m[2]*x + m[6]*y + m[10]*z + m[14]*w,
    m[3]*x + m[7]*y + m[11]*z + m[15]*w,
  ];
}
/* ------------------------------------------------------------- Part C ---- */

/**
 * View matrix for a camera at `eye` looking at `target`, with `up` as the
 * approximate up direction. Build the camera basis with two cross products.
 * Must stay finite when `up` is parallel to the view direction — handle it.
 * eye, target, up: [x, y, z]
 */
import * as vec3 from './vec3.js';

export function lookAt(eye, target, up) {
  // camera looks at direction -z
  let z = vec3.normalize(vec3.sub(eye, target)); // view-space +z = back from the camera
  let x = vec3.cross(up, z); 

  if (vec3.length(x) < 1e-6) {
    const altUp = Math.abs(z[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    x = vec3.cross(altUp, z);
  }
  x = vec3.normalize(x);
  const y = vec3.cross(z, x); 
  const rot = new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    0, 0, 0, 1,
  ]);

  const tx = -vec3.dot(x, eye);
  const ty = -vec3.dot(y, eye);
  const tz = -vec3.dot(z, eye);
  rot[12] = tx; rot[13] = ty; rot[14] = tz;

  return rot;
}
/**
 * Perspective projection for WebGPU (depth z ∈ [0, 1]).
 * fovY: vertical field of view in radians; aspect = width / height;
 * near, far: positive distances along −z.
 */
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2); 
  const range = far - near;

  const m = new Float32Array(16); // start with a 0
  m[0] = f / aspect;
  m[5] = f;
  m[10] = -far / range;      
  m[11] = -1;  // for w = -z_view 
  m[14] = -(far * near) / range;
  // m[15] = 0 
  return m;
}
/**
 * Orthographic projection for WebGPU (depth z ∈ [0, 1]) of the box
 * x ∈ [left, right], y ∈ [bottom, top], z ∈ [−near, −far] in view space.
 */
export function orthographic(left, right, bottom, top, near, far) {
  const m = new Float32Array(16);
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -1 / (far - near); // z: -near -> 0, -far 
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = -near / (far - near);
  m[15] = 1;
  return m;
}
/* ------------------------------------------------- provided (not graded) - */

/**
 * Pretty-print a column-major matrix as four rows, for showing matrices on
 * screen (Part A asks you to display T·R·S and S·R·T).
 */
export function format(m, digits = 2) {
  if (!m) return '(none)';
  const w = digits + 4;
  let s = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) s += (+m[c * 4 + r]).toFixed(digits).padStart(w);
    if (r < 3) s += '\n';
  }
  return s;
}
