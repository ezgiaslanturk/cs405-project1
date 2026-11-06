/**
 * curves — Part D.
 *
 * Points are plain arrays of any dimension: [x, y] in the plane of the
 * painting, or [x, y, z] in world space. Every function must work for both
 * (the tests use 2D and 3D). Return new arrays; never modify the inputs.
 *
 * A piecewise cubic Bézier curve is an array of segments, each segment being
 * four control points [P0, P1, P2, P3]. Consecutive segments share a joint:
 * segments[i][3] equals segments[i + 1][0].
 *
 * Tests: tests/curves.test.js
 */
import { todo } from './todo.js';

/* ---- Bézier ---- */

// helper: linear interpolation between two points, axis by axis (works for 2D or 3D)
function lerpPoint(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/** The four cubic Bernstein basis values [B0(t), B1(t), B2(t), B3(t)]. */
export function bernstein3(t) {
  const mt = 1 - t;
  // standard cubic Bernstein polynomials
  return [
    mt * mt * mt,
    3 * mt * mt * t,
    3 * mt * t * t,
    t * t * t,
  ];
}

/** Point on the cubic Bézier curve with control points p0..p3 at t ∈ [0, 1]. */
export function cubicBezier(p0, p1, p2, p3, t) {
  const [b0, b1, b2, b3] = bernstein3(t);
  const dim = p0.length;
  const out = [];
  // weighted sum of the 4 control points, one axis at a time
  for (let i = 0; i < dim; i++) {
    out[i] = b0 * p0[i] + b1 * p1[i] + b2 * p2[i] + b3 * p3[i];
  }
  return out;
}

/** First derivative dB/dt of the cubic Bézier at t (not normalised). */
export function cubicBezierTangent(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const dim = p0.length;
  const out = [];
  // derivative of the Bernstein basis
  for (let i = 0; i < dim; i++) {
    out[i] =
      3 * mt * mt * (p1[i] - p0[i]) +
      6 * mt * t * (p2[i] - p1[i]) +
      3 * t * t * (p3[i] - p2[i]);
  }
  return out;
}

/**
 * de Casteljau's construction for any number of control points.
 * Returns every level, for drawing the construction:
 *   levels[0] = the input points (n points)
 *   levels[1] = n − 1 interpolated points
 *   …
 *   levels[n − 1] = [the point on the curve]
 */
export function deCasteljau(points, t) {
  // level 0 = copy of the input points, never mutate the originals
  const levels = [points.map((p) => [...p])];

  let current = levels[0];
  // keep lerping neighbouring points until only one point remains
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length - 1; i++) {
      next.push(lerpPoint(current[i], current[i + 1], t));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

/* ---- piecewise, C¹ joints --- */

/**
 * Given the last two control points P2, P3 of one segment, return the P1 of
 * the NEXT segment that makes the joint at P3 C¹-continuous.
 */
export function c1NextControl(p2, p3) {
  // reflect p2 through p3 so the tangent direction stays the same across the joint
  return p3.map((v, i) => 2 * v - p2[i]);
}

/**
 * Evaluate a piecewise cubic Bézier at a global parameter u ∈ [0, 1] that
 * runs over the whole curve: with n segments, segment i covers
 * u ∈ [i/n, (i+1)/n]. u = 0 is the first P0, u = 1 the last P3.
 */
export function evalPiecewise(segments, u) {
  const n = segments.length;
  // which segment does u fall into
  let i = Math.floor(u * n);
  if (i >= n) i = n - 1; // clamp for u = 1 exactly
  if (i < 0) i = 0;

  const localT = u * n - i; // rescale to [0, 1] within that segment
  const [p0, p1, p2, p3] = segments[i];
  return cubicBezier(p0, p1, p2, p3, localT);
}

/* ---- second curve family: implement ONE ---- */
/* The tests skip whichever of the two you leave as a TODO, and fail only   */
/* if you implement neither.                    */

/**
 * Uniform Catmull–Rom: the segment between p1 and p2 (passes through both),
 * t ∈ [0, 1], with tangents (p2 − p0)/2 at p1 and (p3 − p1)/2 at p2.
 */
export function catmullRom(p0, p1, p2, p3, t) {
  // standard Catmull-Rom formula, written out axis by axis
  const t2 = t * t;
  const t3 = t2 * t;
  const dim = p1.length;
  const out = [];
  for (let i = 0; i < dim; i++) {
    out[i] =
      0.5 *
      (2 * p1[i] +
        (-p0[i] + p2[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

/** Uniform cubic B-spline basis values [N0(t), N1(t), N2(t), N3(t)]. */
export function bsplineBasis(t) { return todo('curves.bsplineBasis'); }

/** Point on the uniform cubic B-spline segment controlled by p0..p3. */
export function bspline(p0, p1, p2, p3, t) { return todo('curves.bspline'); }