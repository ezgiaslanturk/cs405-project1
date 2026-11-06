/**
 * Entry point: wires GPU, painting, camera, scene and UI together and runs
 * the render loop. You will edit this file a little (camera controls, views);
 * most of your work goes into src/math/ and src/scene/.
 *
 *   p_clip = P · V · M · p_object
 */
import './ui/style.css';
import { initWebGPU, showFatal } from './render/gpu.js';
import { Renderer } from './render/renderer.js';
import { Painting } from './render/painting.js';
import { createCamera, viewProjection, cameraRay, frustumLines } from './scene/camera.js';
import { LineBatch } from './render/lines.js';
import { createScene } from './scene/scene.js';
import { createPanel } from './ui/panel.js';
import { Stats } from './ui/stats.js';
import { attachPointer } from './ui/input.js';
import { PAINTINGS, DEFAULT_PAINTING, paintingURL } from './config.js';
import * as mat4 from './math/mat4.js';

async function main() {
  const canvas = document.getElementById('gfx');
  const gpu = await initWebGPU(canvas);
  const renderer = new Renderer(gpu);
  const painting = new Painting(gpu);

  const params = new URLSearchParams(location.search);
  let current = PAINTINGS.find((p) => p.id === params.get('painting'))
    ?? PAINTINGS.find((p) => p.id === DEFAULT_PAINTING);
  await painting.load(paintingURL(current));

  /* ---------------- UI ---------------- */
  const panelRoot = document.getElementById('panel');
  const panel = createPanel(panelRoot);
  const title = document.createElement('h1');
  title.textContent = 'CS405 · Project 1';
  panelRoot.appendChild(title);
  const stats = new Stats(panelRoot);

  const pf = panel.folder('Painting');
  pf.select('painting', PAINTINGS.map((p) => ({ value: p.id, label: `${p.artist} — ${p.title}` })), current.id,
    async (id) => {
      current = PAINTINGS.find((p) => p.id === id);
      await painting.load(paintingURL(current));
      history.replaceState(null, '', `?painting=${id}`);
    });

  const camera = createCamera();
  // orbit state: spherical coordinates around camera.target
  const ORBIT0 = { yaw: 0, pitch: 0.3, radius: 2.8 };
  const orbit = { ...ORBIT0 };
  function updateEyeFromOrbit() {
    const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
    const cy = Math.cos(orbit.yaw), sy = Math.sin(orbit.yaw);
    camera.eye = [
      camera.target[0] + orbit.radius * cp * sy,
      camera.target[1] + orbit.radius * sp,
      camera.target[2] + orbit.radius * cp * cy,
    ];
  }
  updateEyeFromOrbit();
  const cf = panel.folder('Camera');
  const camStatus = cf.text('');
  const uiProj = cf.select('projection', ['perspective', 'orthographic'], camera.projection, (v) => (camera.projection = v));
  // fov in degrees for the slider; near/far directly (Part C: their effect on depth precision)
  const camUI = { fovDeg: camera.fovY * 180 / Math.PI };
  const uiCam = [
    cf.slider('fovY (°)', camUI, 'fovDeg', 10, 100, 1, (v) => (camera.fovY = v * Math.PI / 180)),
    cf.slider('near', camera, 'near', 0.001, 2, 0.001),
    cf.slider('far', camera, 'far', 3, 100, 0.5),
  ];
  const camReadout = cf.text('');

  // Part C: a second, FIXED "inspection" camera that looks at the scene from the
  // side and above, and draws the main camera's frustum.
  const inspection = Object.assign(createCamera(), {
    eye: [5.5, 3.5, 7.5], target: [0, 0, 1.2], fovY: 50 * Math.PI / 180, near: 0.5, far: 100,
  });
  const frustumBatch = new LineBatch(gpu, 'line-list');
  const view = { which: 'main' };

  const scene = createScene({ gpu, renderer, painting, panel, paintingId: () => current.id });

  const vf = panel.folder('View');
  const uiView = vf.select('view', [
    { value: 'main', label: 'main camera (orbit)' },
    { value: 'inspection', label: 'inspection camera + frustum' },
  ], view.which, (v) => (view.which = v));
  vf.button('reset', () => {
    Object.assign(camera, createCamera());
    Object.assign(orbit, ORBIT0);
    updateEyeFromOrbit();
    camUI.fovDeg = camera.fovY * 180 / Math.PI;
    uiCam.forEach((c) => c.update());
    uiProj.set(camera.projection);
    view.which = 'main'; uiView.set('main');
    scene.reset();
  });
  vf.note(gpu.encodeSRGB ? 'sRGB: encoded in shader (fallback)' : 'sRGB: canvas -srgb view');

  /* -------------- input --------------- */
  // Part D: in the main view, a left-drag that starts on a control point moves
  // it in the plane of the painting; shift+click adds a point. Anything else orbits.
  const cssSize = () => [canvas.clientWidth, canvas.clientHeight];
  const aspectNow = () => canvas.width / canvas.height;
  let mainVP = null;
  const editing = () => view.which === 'main' && mainVP;
  attachPointer(canvas, {
    down(e) {
      if (!editing() || e.button !== 0) return;
      const k = scene.curve.pick(e.ndc, mainVP, cssSize());
      if (k >= 0) scene.curve.beginDrag(k);
      else if (e.shift) scene.curve.addAt(cameraRay(camera, aspectNow(), e.ndc));
    },
    move(e) {
      scene.curve.hover(editing() ? scene.curve.pick(e.ndc, mainVP, cssSize()) : -1);
    },
    up() { scene.curve.endDrag(); },
    // Part C: left-drag orbits the camera around its target
    drag(e) {
      if (scene.curve.dragging) { scene.curve.dragTo(cameraRay(camera, aspectNow(), e.ndc)); return; }
      if (e.shift) return;
      const speed = 0.005;
      orbit.yaw -= e.dx * speed;
      orbit.pitch += e.dy * speed;
      // clamp pitch so the camera cannot flip over the top/bottom pole
      const limit = Math.PI / 2 - 0.05;
      orbit.pitch = Math.max(-limit, Math.min(limit, orbit.pitch));
      updateEyeFromOrbit();
    },
    // Part C: wheel zooms by changing the orbit radius
    wheel(e) {
      const speed = 0.0015;
      orbit.radius *= 1 + e.delta * speed;
      orbit.radius = Math.max(0.5, Math.min(8, orbit.radius));
      updateEyeFromOrbit();
    },
  });

  /* ------------ render loop ----------- */
  let last = performance.now();
  function frame(now) {
    stats.begin(now);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    scene.update(dt, now / 1000);

    const aspect = canvas.width / canvas.height;
    // orthographic box as tall as the perspective view at the target, so switching keeps the scale
    camera.orthoHeight = 2 * orbit.radius * Math.tan(camera.fovY / 2);
    const mainView = viewProjection(camera, aspect, painting.aspect);
    mainVP = mainView.fallback ? null : mainView.matrix;
    const vp = view.which === 'inspection' ? viewProjection(inspection, aspect, painting.aspect) : mainView;
    camStatus.set(vp.fallback
      ? `PLACEHOLDER view (no camera yet)\n${vp.missing}`
      : `${view.which} view: P · V (${view.which === 'main' ? camera.projection : 'perspective'})`);
    camStatus.el.classList.toggle('warn', vp.fallback);
    camReadout.set(
      `eye    ${camera.eye.map((x) => x.toFixed(2)).join(', ')}\n` +
      `target ${camera.target.map((x) => x.toFixed(2)).join(', ')}\n` +
      `fovY ${(camera.fovY * 180 / Math.PI).toFixed(1)}°  near ${(+camera.near).toFixed(3)}  far ${(+camera.far).toFixed(1)}` +
      (camera.projection === 'orthographic' ? `\northo height ${camera.orthoHeight.toFixed(2)}` : '')
    );

    const paintingMVP = vp.fallback ? vp.matrix : mat4.multiply(vp.matrix, painting.model);
    renderer.render((pass) => {
      painting.draw(pass, paintingMVP, renderer);
      scene.draw(pass, vp.matrix);
      // Part C: the main camera's view volume, seen from the inspection camera
      if (view.which === 'inspection') frustumBatch.draw(pass, renderer, vp.matrix, frustumLines(camera, aspect), [0.3, 0.9, 1.0, 1]);
    });

    stats.end(renderer.stats);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  showFatal(e.message ?? String(e));
});
