/**
 * Camera — Part C.
 *
 * The camera is plain data. viewProjection() turns it into P · V using YOUR
 * mat4.lookAt / mat4.perspective / mat4.orthographic / mat4.multiply.
 *
 * Until those exist it falls back to a fixed "fit the painting to the window"
 * matrix, so the starter shows your painting from the first `npm run dev`.
 * The panel tells you which of the two is active.
 */
import * as mat4 from '../math/mat4.js';
import { NotImplemented } from '../math/todo.js';

export function createCamera() {
  return {
    eye: [0, 0, 2.8],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fovY: Math.PI / 4, // radians
    near: 0.1,
    far: 10, // the scene fits in ~10 units; a tight far keeps the frustum readable in the inspection view
    projection: 'perspective', // or 'orthographic'
    orthoHeight: 2.2, // world units visible vertically in orthographic mode
  };
}

/**
 * @param {object} cam     from createCamera()
 * @param {number} aspect  canvas width / height
 * @param {number} paintingAspect  image width / height (only used by the fallback)
 * @returns {{ matrix: Float32Array, fallback: boolean, missing?: string }}
 */
export function viewProjection(cam, aspect, paintingAspect = 1) {
  try {
    const view = mat4.lookAt(cam.eye, cam.target, cam.up);
    let proj;
    if (cam.projection === 'orthographic') {
      const h = cam.orthoHeight / 2, w = h * aspect;
      proj = mat4.orthographic(-w, w, -h, h, cam.near, cam.far);
    } else {
      proj = mat4.perspective(cam.fovY, aspect, cam.near, cam.far);
    }
    return { matrix: mat4.multiply(proj, view), fallback: false };
  } catch (e) {
    if (!(e instanceof NotImplemented)) throw e;
    return { matrix: fitMatrix(aspect, paintingAspect), fallback: true, missing: e.message };
  }
}

/**
 * Placeholder used until Part C works: scales the painting quad (height 2,
 * width 2·paintingAspect, centred at the origin in the z = 0 plane) to fit
 * the canvas, and maps world z to depth so that +z is in front.
 * There is no camera here — do not build on this.
 */
function fitMatrix(aspect, paintingAspect) {
  const s = 0.92 * Math.min(1, aspect / paintingAspect);
  return new Float32Array([
    s / aspect, 0, 0, 0,
    0, s, 0, 0,
    0, 0, -0.05, 0,
    0, 0, 0.5, 1,
  ]);
}

/* ---------------------------------------------------------------------------
 * Helpers built on the camera basis. The rows of V = lookAt(...) are the
 * camera axes u (right), v (up), w (backwards), so reading them back from V
 * reuses lookAt's handling of the degenerate up vector.
 * ------------------------------------------------------------------------- */

/** Camera axes [u, v, w] in world space. */
export function cameraBasis(cam) {
  const V = mat4.lookAt(cam.eye, cam.target, cam.up);
  return [[V[0], V[4], V[8]], [V[1], V[5], V[9]], [V[2], V[6], V[10]]];
}

const along = (p, ...terms) => terms.reduce((q, [d, s]) => [q[0] + d[0] * s, q[1] + d[1] * s, q[2] + d[2] * s], p);

/**
 * World-space ray through a pointer position (Part D picking): the inverse of
 * the projection, written with the camera basis instead of a 4×4 inverse.
 * @param ndc [x, y] in [−1, 1], +y up
 */
export function cameraRay(cam, aspect, ndc) {
  const [u, v, w] = cameraBasis(cam);
  if (cam.projection === 'orthographic') {
    const h = cam.orthoHeight / 2;
    return { origin: along(cam.eye, [u, ndc[0] * h * aspect], [v, ndc[1] * h]), dir: [-w[0], -w[1], -w[2]] };
  }
  const th = Math.tan(cam.fovY / 2);
  const d = along([-w[0], -w[1], -w[2]], [u, ndc[0] * th * aspect], [v, ndc[1] * th]);
  const L = Math.hypot(...d);
  return { origin: [...cam.eye], dir: d.map((x) => x / L) };
}

/**
 * The 8 corners of the view volume in world space (Part C, frustum view):
 * near (−−, +−, ++, −+) then far, followed by the eye. Same near/far for both projections.
 */
export function frustumCorners(cam, aspect) {
  const [u, v, w] = cameraBasis(cam);
  const out = [];
  for (const d of [cam.near, cam.far]) {
    const hh = cam.projection === 'orthographic' ? cam.orthoHeight / 2 : d * Math.tan(cam.fovY / 2);
    const hw = hh * aspect;
    const c = along(cam.eye, [w, -d]);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(along(c, [u, sx * hw], [v, sy * hh]));
  }
  return out;
}

/** frustumCorners() as a line-list: near and far rectangles, the four side edges, and rays from the eye. */
export function frustumLines(cam, aspect) {
  const c = frustumCorners(cam, aspect), L = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    L.push(c[i], c[j], c[4 + i], c[4 + j], c[i], c[4 + i]);
    if (cam.projection !== 'orthographic') L.push(cam.eye, c[i]);
  }
  return L;
}
