/**
 * Curve export — Part D.
 *
 * Required JSON format (control points in NORMALISED painting coordinates:
 * u, v ∈ [0, 1], origin at the TOP-LEFT corner of the painting, v downwards,
 * the same as texture coordinates):
 *
 * {
 *   "painting": "kavunlu",
 *   "kind": "bezier-c1",                 // or "catmull-rom" / "bspline"
 *   "segments": [                          // for "bezier-c1": 4 points each
 *     [[0.12, 0.40], [0.18, 0.31], [0.27, 0.30], [0.33, 0.38]],
 *     ...
 *   ],
 *   "points": [[u, v], ...]                // for "catmull-rom" / "bspline"
 * }
 *
 * The painting quad spans x ∈ [−a, a], y ∈ [−1, 1] at z = 0 (a = image
 * width / height), so  u = (x + a) / (2a)  and  v = (1 − y) / 2.
 */
/**
 * Part D: build the object above from the curve data.
 * @param {{painting: string, aspect: number, kind: string, points: number[][]}} curve
 *   points: control points in WORLD space [x, y] on the painting plane, in order
 *   (for 'bezier-c1': 3n + 1 points, joints shared between segments).
 */
export function curveToJSON(curve) {
  const a = curve.aspect;
  const r = (x) => Math.round(x * 10000) / 10000;
  const toUV = ([x, y]) => [r((x + a) / (2 * a)), r((1 - y) / 2)];
  const uv = curve.points.map(toUV);
  const out = { painting: curve.painting, kind: curve.kind };
  if (curve.kind === 'bezier-c1') {
    out.segments = [];
    for (let i = 0; i + 3 < uv.length; i += 3) out.segments.push(uv.slice(i, i + 4));
  } else {
    out.points = uv;
  }
  return out;
}

/** Provided: save any object as a .json download in the browser. */
export function downloadJSON(obj, filename = 'curve.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
