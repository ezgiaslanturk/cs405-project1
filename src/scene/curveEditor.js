/**
 * Curve editor — Part D.
 *
 * Two curve families over the painting, both edited with the mouse in the
 * plane of the painting (z = CURVE_Z, just in front of the canvas):
 *   • 'bezier-c1'   piecewise cubic Bézier, 3n + 1 control points, C¹ enforced
 *                   at every joint while you drag (curves.c1NextControl)
 *   • 'catmull-rom' uniform Catmull–Rom through every control point
 *
 * Control points are STORED in normalised painting coordinates (u, v ∈ [0, 1],
 * origin top-left, v down — the export format) and mapped to world space with
 *   x = (2u − 1)·a,  y = 1 − 2v   (a = painting aspect)
 * every frame, so they stay on the same spot of the picture if the window or
 * the painting changes. The map is affine, and Bézier / Catmull–Rom curves are
 * affine-invariant, so evaluating in world space gives exactly the mapped curve.
 *
 * Also: the de Casteljau construction at an adjustable t, an object animated
 * along the curve at constant speed (arc-length table) and oriented by the
 * tangent, and the JSON export.
 */
import * as curves from '../math/curves.js';
import * as mat4 from '../math/mat4.js';
import { LineBatch, crosses } from '../render/lines.js';
import { curveToJSON, downloadJSON } from './curveExport.js';

export const CURVE_Z = 0.01;

// Kavunlu Natürmort: top silhouette of the whole melon (3 Bézier segments).
// Points 4 and 7 are recomputed by enforceC1() so the joints start out C¹.
const DEFAULT_BEZIER = [
  [0.300, 0.300], [0.315, 0.210], [0.390, 0.130],
  [0.480, 0.112], [0.580, 0.100], [0.680, 0.115],
  [0.760, 0.160], [0.840, 0.205], [0.885, 0.300],
  [0.885, 0.420],
];
// Kavunlu Natürmort: lower edge of the cut slice in front (Catmull–Rom).
const DEFAULT_CATMULL = [
  [0.185, 0.625], [0.240, 0.715], [0.360, 0.780], [0.500, 0.810],
  [0.650, 0.800], [0.760, 0.750], [0.815, 0.675],
];

const ARC_SAMPLES = 256;

export function createCurveEditor({ gpu, renderer, painting, panel, paintingId }) {
  const state = {
    kind: 'bezier-c1',
    casteljau: true,     // show the construction
    t: 0.35,             // global parameter of the construction, ∈ [0, 1]
    animate: true,
    speed: 0.12,         // fraction of the curve per second
    s: 0,                // arc-length position of the animated object, ∈ [0, 1)
  };
  let bez, cr;
  let dragIndex = -1;
  let hoverIndex = -1;

  function reset() {
    bez = DEFAULT_BEZIER.map((p) => [...p]);
    cr = DEFAULT_CATMULL.map((p) => [...p]);
    enforceC1();
    state.s = 0;
  }

  /* ---------- coordinates ---------- */
  const a = () => painting.aspect;
  const toWorld = ([u, v]) => [(2 * u - 1) * a(), 1 - 2 * v, CURVE_Z];
  const toUV = ([x, y]) => [(x / a() + 1) / 2, (1 - y) / 2];
  const active = () => (state.kind === 'bezier-c1' ? bez : cr);

  /* ---------- C¹ at every interior joint (index 3, 6, …) ---------- */
  function enforceC1() {
    for (let j = 3; j + 1 < bez.length; j += 3) bez[j + 1] = curves.c1NextControl(bez[j - 1], bez[j]);
  }

  /** Move control point k of the active curve to uv, keeping the Bézier joints C¹. */
  function movePoint(k, uv) {
    const P = active();
    if (state.kind !== 'bezier-c1') { P[k] = uv; return; }
    const n = P.length;
    const delta = [uv[0] - P[k][0], uv[1] - P[k][1]];
    P[k] = uv;
    if (k % 3 === 0) {
      // a joint carries its two handles with it (tangents unchanged)
      for (const h of [k - 1, k + 1]) if (h >= 0 && h < n) P[h] = [P[h][0] + delta[0], P[h][1] + delta[1]];
    } else if (k % 3 === 1 && k >= 4) {
      P[k - 2] = curves.c1NextControl(P[k], P[k - 1]);      // mirror through joint k − 1
    } else if (k % 3 === 2 && k + 2 < n) {
      P[k + 2] = curves.c1NextControl(P[k], P[k + 1]);      // mirror through joint k + 1
    }
  }

  /* ---------- evaluation (world space) ---------- */
  function bezierSegments() {
    const W = bez.map(toWorld), segs = [];
    for (let i = 0; i + 3 < W.length; i += 3) segs.push([W[i], W[i + 1], W[i + 2], W[i + 3]]);
    return segs;
  }
  /** Catmull–Rom segments; the end points are duplicated so the curve starts/ends on them. */
  function catmullSegments() {
    const W = cr.map(toWorld);
    const P = [W[0], ...W, W[W.length - 1]], segs = [];
    for (let i = 0; i + 3 < P.length; i++) segs.push([P[i], P[i + 1], P[i + 2], P[i + 3]]);
    return segs;
  }
  const segments = () => (state.kind === 'bezier-c1' ? bezierSegments() : catmullSegments());

  /** Point and tangent at the global parameter u ∈ [0, 1] (segment i covers [i/n, (i+1)/n]). */
  function evalAt(segs, u) {
    const n = segs.length;
    const i = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
    const t = u * n - i;
    const s = segs[i];
    if (state.kind === 'bezier-c1') {
      return { p: curves.evalPiecewise(segs, u), d: curves.cubicBezierTangent(...s, t) };
    }
    // Catmull–Rom: tangent by central difference (the curve is C¹, so this is exact enough)
    const h = 1e-3;
    const p0 = curves.catmullRom(...s, Math.max(0, t - h)), p1 = curves.catmullRom(...s, Math.min(1, t + h));
    return { p: curves.catmullRom(...s, t), d: p1.map((x, k) => x - p0[k]) };
  }

  function sample(segs, steps = 32) {
    const out = [];
    segs.forEach((s, i) => {
      for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
        const t = k / steps;
        out.push(state.kind === 'bezier-c1' ? curves.cubicBezier(...s, t) : curves.catmullRom(...s, t));
      }
    });
    return out;
  }

  /** Global parameter u for an arc-length fraction s — constant speed along the curve. */
  function uAtArcLength(segs, s) {
    const len = [0];
    let prev = evalAt(segs, 0).p;
    for (let k = 1; k <= ARC_SAMPLES; k++) {
      const p = evalAt(segs, k / ARC_SAMPLES).p;
      len.push(len[k - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      prev = p;
    }
    const target = s * len[ARC_SAMPLES];
    let lo = 0, hi = ARC_SAMPLES;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (len[mid] < target) lo = mid; else hi = mid; }
    const f = len[hi] > len[lo] ? (target - len[lo]) / (len[hi] - len[lo]) : 0;
    return (lo + f) / ARC_SAMPLES;
  }

  /* ---------- UI ---------- */
  const f = panel.folder('Curves (Part D)');
  f.select('curve', [
    { value: 'bezier-c1', label: 'piecewise Bézier (C¹)' },
    { value: 'catmull-rom', label: 'Catmull–Rom' },
  ], state.kind, (v) => { state.kind = v; dragIndex = hoverIndex = -1; });
  const uiCast = f.toggle('de Casteljau', state, 'casteljau');
  const uiT = f.slider('t (construction)', state, 't', 0, 1, 0.001);
  const uiAnim = f.toggle('animate object', state, 'animate');
  const uiSpeed = f.slider('speed', state, 'speed', 0, 0.5, 0.01);
  f.button('add segment / point', () => addPoint());
  f.button('remove last', () => removeLast());
  f.button('export JSON', () => {
    const json = toJSON();
    console.log(JSON.stringify(json));
    downloadJSON(json, `curve-${json.painting}-${json.kind}.json`);
  });
  f.note('Drag a control point (left mouse). Shift+click on the painting adds a point / segment at the end.');
  const readout = f.text('');

  function toJSON() {
    return curveToJSON({
      painting: paintingId(),
      aspect: a(),
      kind: state.kind,
      points: active().map(toWorld).map((p) => [p[0], p[1]]),
    });
  }

  function addPoint(uv) {
    const P = active();
    const last = P[P.length - 1];
    if (state.kind === 'bezier-c1') {
      // a new segment: C¹ handle, then a second handle and a new end point
      const end = uv ?? [Math.min(1, last[0] + 0.05), Math.min(1, last[1] + 0.05)];
      const p1 = curves.c1NextControl(P[P.length - 2], last);
      const p2 = [p1[0] + (end[0] - p1[0]) * 0.5, p1[1] + (end[1] - p1[1]) * 0.5];
      P.push(p1, p2, end);
    } else {
      P.push(uv ?? [Math.min(1, last[0] + 0.05), Math.min(1, last[1] + 0.05)]);
    }
  }
  function removeLast() {
    // keep at least three segments (Part D asks for ≥ 3)
    if (state.kind === 'bezier-c1') { if (bez.length > 10) bez.length -= 3; }
    else if (cr.length > 4) cr.length -= 1;
  }

  /* ---------- picking (called from main.js) ---------- */
  /**
   * Nearest control point to the pointer, in screen pixels.
   * @param ndc  pointer in NDC; viewProj: the camera's P·V; size: canvas CSS [w, h]
   */
  function pick(ndc, viewProj, size, radiusPx = 12) {
    let best = -1, bestD = radiusPx;
    active().forEach((uv, k) => {
      const [x, y, z] = toWorld(uv);
      const c = mat4.transformVec4(viewProj, [x, y, z, 1]);
      if (c[3] <= 0) return;
      const dx = (c[0] / c[3] - ndc[0]) * size[0] / 2, dy = (c[1] / c[3] - ndc[1]) * size[1] / 2;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  /** Intersect a ray with the curve plane z = CURVE_Z; returns uv or null. */
  function rayToUV(ray) {
    if (Math.abs(ray.dir[2]) < 1e-6) return null;
    const t = (CURVE_Z - ray.origin[2]) / ray.dir[2];
    if (t <= 0) return null;
    const x = ray.origin[0] + t * ray.dir[0], y = ray.origin[1] + t * ray.dir[1];
    const [u, v] = toUV([x, y]);
    return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
  }

  /* ---------- drawing ---------- */
  const B = {
    curve: new LineBatch(gpu, 'line-strip'),
    polygon: new LineBatch(gpu, 'line-strip'),
    points: new LineBatch(gpu, 'line-list'),
    selected: new LineBatch(gpu, 'line-list'),
    l1: new LineBatch(gpu, 'line-strip'),
    l2: new LineBatch(gpu, 'line-strip'),
    castPts: new LineBatch(gpu, 'line-list'),
    onCurve: new LineBatch(gpu, 'line-list'),
    tangent: new LineBatch(gpu, 'line-list'),
  };
  const lift = (p, dz) => [p[0], p[1], p[2] + dz];

  let objectModel = mat4.identity();
  let tangentLine = [];

  reset();

  return {
    state,
    reset() { reset(); [uiCast, uiT, uiAnim, uiSpeed].forEach((c) => c.update()); },
    pick,
    /** Start dragging point k (from pick()). */
    beginDrag(k) { dragIndex = k; },
    get dragging() { return dragIndex >= 0; },
    dragTo(ray) { const uv = rayToUV(ray); if (uv && dragIndex >= 0) movePoint(dragIndex, uv); },
    endDrag() { dragIndex = -1; },
    hover(k) { hoverIndex = k; },
    /** Shift+click: append a point / segment where the ray meets the painting. */
    addAt(ray) { const uv = rayToUV(ray); if (uv) addPoint(uv); },
    /** Model matrix of the animated object (drawn by scene.js with the mesh pipeline). */
    get objectModel() { return objectModel; },
    toJSON,

    update(dt) {
      const segs = segments();
      if (state.animate) state.s = (state.s + state.speed * dt) % 1;
      const { p, d } = evalAt(segs, uAtArcLength(segs, state.s));
      // orientation from the tangent: rotate the object's +x onto the tangent (in the painting plane)
      const angle = Math.atan2(d[1], d[0]);
      objectModel = mat4.multiply(
        mat4.multiply(mat4.translate(p[0], p[1], p[2] + 0.04), mat4.rotateZ(angle)),
        mat4.scale(0.16, 0.05, 0.05));
      const len = Math.hypot(d[0], d[1]) || 1;
      tangentLine = [lift(p, 0.002), [p[0] + 0.3 * d[0] / len, p[1] + 0.3 * d[1] / len, p[2] + 0.002]];

      // readout: C¹ check at each joint (tangent from the left vs from the right)
      let txt = `${state.kind}: ${active().length} control points, ${segs.length} segments\n`;
      if (state.kind === 'bezier-c1') {
        for (let i = 0; i + 1 < segs.length; i++) {
          const L = curves.cubicBezierTangent(...segs[i], 1), R = curves.cubicBezierTangent(...segs[i + 1], 0);
          txt += `joint ${i + 1}: |B'(1⁻) − B'(0⁺)| = ${Math.hypot(L[0] - R[0], L[1] - R[1]).toExponential(1)}\n`;
        }
      }
      const P = active();
      const k = dragIndex >= 0 ? dragIndex : hoverIndex;
      if (k >= 0 && k < P.length) txt += `point ${k}: (u, v) = (${P[k][0].toFixed(3)}, ${P[k][1].toFixed(3)})`;
      readout.set(txt.trimEnd());
    },

    draw(pass, viewProj) {
      const P = active().map(toWorld);
      const segs = segments();
      B.polygon.draw(pass, renderer, viewProj, P, [0.55, 0.55, 0.6, 1]);
      B.curve.draw(pass, renderer, viewProj, sample(segs).map((p) => lift(p, 0.001)), [1.0, 0.85, 0.1, 1]);
      B.points.draw(pass, renderer, viewProj, crosses(P), [1.0, 0.15, 0.1, 1]);
      const k = dragIndex >= 0 ? dragIndex : hoverIndex;
      if (k >= 0 && k < P.length) B.selected.draw(pass, renderer, viewProj, crosses([lift(P[k], 0.002)], 0.04), [1, 1, 1, 1]);

      if (state.kind === 'bezier-c1' && state.casteljau) {
        const n = segs.length;
        const i = Math.min(n - 1, Math.floor(state.t * n));
        const levels = curves.deCasteljau(segs[i], state.t * n - i).map((l) => l.map((p) => lift(p, 0.003)));
        B.l1.draw(pass, renderer, viewProj, levels[1], [0.3, 0.85, 1.0, 1]);
        B.l2.draw(pass, renderer, viewProj, levels[2], [1.0, 0.35, 0.9, 1]);
        B.castPts.draw(pass, renderer, viewProj, crosses([...levels[1], ...levels[2]], 0.015), [0.9, 0.9, 0.9, 1]);
        B.onCurve.draw(pass, renderer, viewProj, crosses(levels[3], 0.035), [0.2, 1.0, 0.3, 1]);
      }
      B.tangent.draw(pass, renderer, viewProj, tangentLine, [1, 1, 1, 1]);
    },
  };
}
