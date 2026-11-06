# CS405 Project 1 — Transformations, Projection & Curves from Paintings

**Painting:** Şeker Ahmed Paşa — *Kavunlu Natürmort* (Sakıp Sabancı Museum).
One WebGPU application (no Three.js / gl-matrix; only my own maths) that hangs the
painting in a small 3D scene, places objects in front of it, moves a camera around
them and traces curves over the painted melon.

## Running it

Requirements: Node.js 20.19+ and a browser with WebGPU (current Chrome / Edge,
Safari 26+, Firefox 141+ on Windows).

```bash
npm install
npm run dev        # opens http://localhost:5173
npm test           # unit tests for the maths (node --test)
```

Another painting can be chosen in the panel or with `?painting=<id>` in the URL
(`kavunlu`, `kabatas`, `moda`, `selim-turbesi`, `ormanda-karaca`).

## Controls

### Mouse (on the canvas)

| Action | Effect |
|---|---|
| Left-drag on empty space | Orbit the main camera around its target (yaw / pitch, pitch clamped below ±90°) |
| Mouse wheel | Zoom (orbit radius 0.5 – 8) |
| Left-drag on a control point (red ×) | Move it in the plane of the painting. For the Bézier curve, dragging a joint carries its two handles; dragging a handle mirrors the opposite handle through the joint, so the curve stays **C¹** |
| Shift + click on the painting | Append a control point (Catmull–Rom) or a new C¹ segment (Bézier) ending there |

Curve editing works in the **main** view (perspective or orthographic).

### Panel

| Folder | Control | Effect |
|---|---|---|
| (top) | frame / cpu / draws / vertices | Frame time (ms, smoothed), CPU time per frame, draw calls and **vertices submitted per frame** |
| Painting | painting | Switch painting |
| Camera | projection | Perspective ↔ orthographic at run time (same near/far; the ortho box has the height of the perspective view at the target, so the scene keeps its size) |
| Camera | fovY, near, far | Projection parameters (try near = 0.001 to see depth precision suffer) |
| Camera | readout | eye, target, fovY, near, far of the main camera |
| Scene | debug axes | Draw every scene-graph node's local axes (x red, y green, z blue) |
| Scene | object A · x/y/z, angle, scale | Translation, rotation angle (about y) and uniform scale of the UI-controlled cube |
| Scene | object A · order | Switch between **M = T·R·S** and **M = S·R·T**; both matrices are shown numerically below, the active one is marked |
| Curves (Part D) | curve | Piecewise cubic Bézier (C¹, 3 segments) or Catmull–Rom |
| Curves (Part D) | de Casteljau, t | Show the de Casteljau construction at global parameter t (level 1 cyan, level 2 magenta, point on the curve green) |
| Curves (Part D) | animate object, speed | Object moving along the curve at constant speed (arc-length table), oriented by the tangent (white line) |
| Curves (Part D) | add segment / point, remove last | Edit the curve (at least 3 segments are kept) |
| Curves (Part D) | export JSON | Download the active curve as JSON (control points in normalised painting coordinates); also printed to the console |
| Curves (Part D) | readout | C¹ check at every joint, and (u, v) of the point under the mouse |
| View | view | **main camera** (orbit) or **inspection camera** (fixed, draws the main camera's frustum in cyan) |
| View | reset | Reset camera, view, object A and both curves |

## Conventions

Column-major `Float32Array(16)` matrices (element (r, c) at `c*4 + r`), column
vectors (`multiply(A, B)` = A·B, B first), right-handed world, radians. The rest
of the code composes local transforms as **T·R·S**. View space looks down −z;
clip space is WebGPU's (NDC z ∈ [0, 1]). The painting is centred at the origin
in z = 0 with y ∈ [−1, 1]; objects sit at z > 0.

## Code structure

| Path | Contents |
|---|---|
| `src/math/` | `vec3.js`, `mat4.js` (Part A/C), `curves.js` (Bézier, de Casteljau, C¹, Catmull–Rom) |
| `src/scene/node.js` | Scene-graph node: local, parent, children, world by traversal |
| `src/scene/scene.js` | Part A objects, Part B tree (root → pedestal → arm → ornament, root → satellite → moon), debug axes |
| `src/scene/camera.js` | Camera data, P·V, camera ray (picking) and frustum corners |
| `src/scene/curveEditor.js` | Part D: editing, C¹ enforcement, de Casteljau, animation along the curve |
| `src/scene/curveExport.js` | Part D: JSON export |
| `src/render/` | WebGPU setup, renderer, painting quad, `lines.js` (line batches), WGSL shaders |
| `src/ui/` | Panel, stats, pointer input |
| `tests/` | `npm test` |

Scene-graph nodes keep only the joint frame (T·R) in `local`; the size of each
cube (`data.shape`) is applied on the right when drawing, so a flat pedestal does
not squash its children.

## JSON export format

```json
{ "painting": "kavunlu", "kind": "bezier-c1",
  "segments": [[[u, v], [u, v], [u, v], [u, v]], ...] }
{ "painting": "kavunlu", "kind": "catmull-rom", "points": [[u, v], ...] }
```

u, v ∈ [0, 1], origin at the painting's top-left corner, v downwards:
u = (x + a) / (2a), v = (1 − y) / 2 with a = image width / height.
